import SwiftUI

@main
struct SBRacingWatchApp: App {
    @StateObject private var rideManager = RideSessionManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(rideManager)
        }
    }
}
