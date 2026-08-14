import Foundation
import WatchConnectivity

/// Sends ride status + finished summaries to the paired iPhone (SB Racing app).
final class PhoneConnectivity: NSObject, WCSessionDelegate {
    static let shared = PhoneConnectivity()

    private var session: WCSession? {
        WCSession.isSupported() ? WCSession.default : nil
    }

    private override init() {
        super.init()
    }

    func activate() {
        guard let session else { return }
        session.delegate = self
        session.activate()
    }

    func sendStatus(_ status: String) {
        guard let session, session.isReachable else { return }
        session.sendMessage(["type": "ride_status", "status": status], replyHandler: nil) { _ in }
    }

    func sendRideSummary(_ summary: RideSummary) {
        guard let session else { return }
        let payload = summary.dictionary

        if session.isReachable {
            session.sendMessage(payload, replyHandler: nil) { [weak self] _ in
                // Fallback to transfer if phone not immediately reachable
                self?.session?.transferUserInfo(payload)
            }
        } else {
            session.transferUserInfo(payload)
        }
    }

    // MARK: WCSessionDelegate
    func session(_ session: WCSession,
                 activationDidCompleteWith activationState: WCSessionActivationState,
                 error: Error?) {}

    #if os(iOS)
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }
    #endif
}
