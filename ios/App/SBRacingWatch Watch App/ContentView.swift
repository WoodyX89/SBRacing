import SwiftUI

struct ContentView: View {
    @EnvironmentObject var ride: RideSessionManager

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    // Brand
                    Text("SB RACING")
                        .font(.caption2.weight(.black))
                        .foregroundStyle(.orange)
                        .tracking(1)

                    // Live stats
                    VStack(spacing: 6) {
                        StatRow(label: "Distance", value: ride.distanceLabel)
                        StatRow(label: "Time", value: ride.elapsedLabel)
                        StatRow(label: "Elev ↑", value: ride.elevGainLabel)
                        if ride.status == .recording {
                            HStack(spacing: 4) {
                                Circle()
                                    .fill(Color.red)
                                    .frame(width: 6, height: 6)
                                Text("RECORDING")
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(.red)
                            }
                            .padding(.top, 2)
                        } else if ride.status == .paused {
                            Text("PAUSED")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(.yellow)
                        }
                    }
                    .padding(.vertical, 4)

                    // Primary action
                    if ride.status == .idle {
                        Button {
                            ride.start()
                        } label: {
                            Label("Track Ride", systemImage: "bicycle")
                                .font(.headline.weight(.bold))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.orange)
                    } else {
                        HStack(spacing: 8) {
                            if ride.status == .recording {
                                Button {
                                    ride.pause()
                                } label: {
                                    Image(systemName: "pause.fill")
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 8)
                                }
                                .buttonStyle(.bordered)
                                .tint(.yellow)
                            } else {
                                Button {
                                    ride.resume()
                                } label: {
                                    Image(systemName: "play.fill")
                                        .frame(maxWidth: .infinity)
                                        .padding(.vertical, 8)
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(.orange)
                            }

                            Button(role: .destructive) {
                                ride.stop()
                            } label: {
                                Image(systemName: "stop.fill")
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 8)
                            }
                            .buttonStyle(.bordered)
                        }
                    }

                    if !ride.lastMessage.isEmpty {
                        Text(ride.lastMessage)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.horizontal, 4)
            }
            .navigationTitle("Ride")
            .navigationBarTitleDisplayMode(.inline)
        }
        .onAppear {
            ride.requestPermissionsIfNeeded()
        }
    }
}

private struct StatRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.caption.monospacedDigit().weight(.semibold))
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(RideSessionManager())
}
