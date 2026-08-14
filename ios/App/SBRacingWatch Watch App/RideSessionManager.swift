import Foundation
import CoreLocation
import HealthKit
import Combine

@MainActor
final class RideSessionManager: NSObject, ObservableObject {
    enum Status: String {
        case idle, recording, paused
    }

    @Published var status: Status = .idle
    @Published var distanceM: Double = 0
    @Published var elevGainM: Double = 0
    @Published var elapsedSec: Int = 0
    @Published var pointCount: Int = 0
    @Published var lastMessage: String = ""

    private let locationManager = CLLocationManager()
    private let healthStore = HKHealthStore()
    private var workoutSession: HKWorkoutSession?
    private var workoutBuilder: HKLiveWorkoutBuilder?

    private var points: [(lat: Double, lng: Double, alt: Double?, t: Date)] = []
    private var startDate: Date?
    private var pauseStarted: Date?
    private var pausedAccum: TimeInterval = 0
    private var lastAcceptedAlt: Double?
    private var timer: Timer?

    private let minPointDistanceM: Double = 4
    private let minElevDeltaM: Double = 2.5
    private let maxAccuracyM: Double = 45

    var distanceLabel: String {
        if distanceM < 1000 {
            return String(format: "%.0f m", distanceM)
        }
        return String(format: "%.2f km", distanceM / 1000)
    }

    var elevGainLabel: String {
        String(format: "%.0f m", elevGainM)
    }

    var elapsedLabel: String {
        let s = elapsedSec
        let h = s / 3600
        let m = (s % 3600) / 60
        let sec = s % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, sec)
        }
        return String(format: "%02d:%02d", m, sec)
    }

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 5
        locationManager.activityType = .fitness
        // Allows updates when wrist is down during a workout session
        locationManager.allowsBackgroundLocationUpdates = true
    }

    func requestPermissionsIfNeeded() {
        locationManager.requestWhenInUseAuthorization()

        let types: Set<HKSampleType> = [
            HKObjectType.workoutType(),
            HKQuantityType.quantityType(forIdentifier: .distanceCycling)!,
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!
        ]
        healthStore.requestAuthorization(toShare: types, read: types) { [weak self] ok, error in
            Task { @MainActor in
                if let error {
                    self?.lastMessage = "Health: \(error.localizedDescription)"
                } else if !ok {
                    self?.lastMessage = "Health access not granted"
                }
            }
        }

        PhoneConnectivity.shared.activate()
    }

    func start() {
        guard status == .idle else { return }
        resetMetrics()
        startDate = Date()
        status = .recording
        lastMessage = "Starting…"

        startWorkoutSession()
        locationManager.requestWhenInUseAuthorization()
        locationManager.startUpdatingLocation()
        startTicker()

        lastMessage = "Tracking"
        PhoneConnectivity.shared.sendStatus("recording")
    }

    func pause() {
        guard status == .recording else { return }
        status = .paused
        pauseStarted = Date()
        locationManager.stopUpdatingLocation()
        workoutSession?.pause()
        lastMessage = "Paused"
        PhoneConnectivity.shared.sendStatus("paused")
    }

    func resume() {
        guard status == .paused else { return }
        if let pauseStarted {
            pausedAccum += Date().timeIntervalSince(pauseStarted)
        }
        pauseStarted = nil
        status = .recording
        locationManager.startUpdatingLocation()
        workoutSession?.resume()
        lastMessage = "Tracking"
        PhoneConnectivity.shared.sendStatus("recording")
    }

    func stop() {
        guard status != .idle else { return }
        status = .idle
        locationManager.stopUpdatingLocation()
        stopTicker()
        endWorkoutSession()

        let summary = RideSummary(
            startTs: startDate?.timeIntervalSince1970 ?? Date().timeIntervalSince1970,
            elapsedSec: elapsedSec,
            distanceM: distanceM,
            elevGainM: elevGainM,
            pointCount: points.count,
            points: points.suffix(500).map {
                ["lat": $0.lat, "lng": $0.lng, "alt": $0.alt as Any, "t": $0.t.timeIntervalSince1970]
            }
        )
        PhoneConnectivity.shared.sendRideSummary(summary)
        lastMessage = "Saved · \(distanceLabel)"
    }

    // MARK: - Private

    private func resetMetrics() {
        points = []
        distanceM = 0
        elevGainM = 0
        elapsedSec = 0
        pointCount = 0
        pausedAccum = 0
        pauseStarted = nil
        lastAcceptedAlt = nil
        startDate = nil
    }

    private func startTicker() {
        stopTicker()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.tick()
            }
        }
    }

    private func stopTicker() {
        timer?.invalidate()
        timer = nil
    }

    private func tick() {
        guard status == .recording || status == .paused else { return }
        guard let startDate else { return }
        var end = Date()
        if status == .paused, let pauseStarted {
            end = pauseStarted
        }
        elapsedSec = max(0, Int(end.timeIntervalSince(startDate) - pausedAccum))
    }

    private func accept(location: CLLocation) {
        guard status == .recording else { return }
        guard location.horizontalAccuracy > 0, location.horizontalAccuracy <= maxAccuracyM else { return }

        let lat = location.coordinate.latitude
        let lng = location.coordinate.longitude
        let alt = location.altitude
        let t = location.timestamp

        if let last = points.last {
            let prev = CLLocation(latitude: last.lat, longitude: last.lng)
            let dist = location.distance(from: prev)
            if dist < minPointDistanceM { return }
            distanceM += dist
        }

        if location.verticalAccuracy >= 0 && location.verticalAccuracy < 30 {
            if let lastAlt = lastAcceptedAlt {
                let delta = alt - lastAlt
                if abs(delta) >= minElevDeltaM {
                    if delta > 0 { elevGainM += delta }
                    lastAcceptedAlt = alt
                }
            } else {
                lastAcceptedAlt = alt
            }
        }

        points.append((lat, lng, alt, t))
        pointCount = points.count
    }

    private func startWorkoutSession() {
        let config = HKWorkoutConfiguration()
        // mountainBiking available watchOS 10+; fall back to cycling
        if #available(watchOS 10.0, *) {
            config.activityType = .mountainBiking
        } else {
            config.activityType = .cycling
        }
        config.locationType = .outdoor

        do {
            let session = try HKWorkoutSession(healthStore: healthStore, configuration: config)
            let builder = session.associatedWorkoutBuilder()
            builder.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore, workoutConfiguration: config)

            session.delegate = self
            builder.delegate = self

            workoutSession = session
            workoutBuilder = builder

            session.startActivity(with: Date())
            builder.beginCollection(withStart: Date()) { [weak self] ok, error in
                Task { @MainActor in
                    if let error {
                        self?.lastMessage = "Workout: \(error.localizedDescription)"
                    }
                }
            }
        } catch {
            lastMessage = "Could not start workout: \(error.localizedDescription)"
            // Still track with Core Location only
        }
    }

    private func endWorkoutSession() {
        let end = Date()
        workoutSession?.end()
        workoutBuilder?.endCollection(withEnd: end) { [weak self] _, _ in
            self?.workoutBuilder?.finishWorkout { _, _ in }
        }
        workoutSession = nil
        workoutBuilder = nil
    }
}

// MARK: - CLLocationManagerDelegate
extension RideSessionManager: CLLocationManagerDelegate {
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        Task { @MainActor in
            self.accept(location: location)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.lastMessage = "GPS: \(error.localizedDescription)"
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            switch manager.authorizationStatus {
            case .denied, .restricted:
                self.lastMessage = "Enable Location in Settings"
            default:
                break
            }
        }
    }
}

// MARK: - HKWorkoutSessionDelegate
extension RideSessionManager: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession,
                                    didChangeTo toState: HKWorkoutSessionState,
                                    from fromState: HKWorkoutSessionState,
                                    date: Date) {}

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor in
            self.lastMessage = "Workout error: \(error.localizedDescription)"
        }
    }
}

extension RideSessionManager: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {}
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}

// MARK: - Summary payload for iPhone
struct RideSummary {
    let startTs: TimeInterval
    let elapsedSec: Int
    let distanceM: Double
    let elevGainM: Double
    let pointCount: Int
    let points: [[String: Any]]

    var dictionary: [String: Any] {
        [
            "type": "ride_summary",
            "startTs": startTs,
            "elapsedSec": elapsedSec,
            "distanceM": distanceM,
            "elevGainM": elevGainM,
            "pointCount": pointCount,
            "points": points
        ]
    }
}
