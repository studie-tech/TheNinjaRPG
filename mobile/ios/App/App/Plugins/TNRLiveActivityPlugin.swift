import Capacitor
import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

/// Live Activities: the hospital, training and war countdowns on the Lock Screen and in
/// the Dynamic Island.
///
/// The device starts an activity and hands back a per-activity push token; the server then
/// drives updates over APNs with `apns-push-type: liveactivity`, so the countdown stays
/// right without the app running. On iOS 17.2 and later a push-to-start token lets the
/// server open one the player never started — a raid beginning while the app is closed.
@objc(TNRLiveActivityPlugin)
public class TNRLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TNRLiveActivityPlugin"
    public let jsName = "TNRLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPushToStartToken", returnType: CAPPluginReturnPromise),
    ]

    @objc func start(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        guard #available(iOS 16.1, *) else {
            call.reject("Live Activities need iOS 16.1")
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            // The player has turned Live Activities off for the app. Not an error worth
            // reporting — the web side treats a rejection as "not available".
            call.reject("Live Activities are disabled for this app")
            return
        }
        guard let kindRaw = call.getString("kind"),
              let kind = TNRActivityAttributes.Kind(rawValue: kindRaw) else {
            call.reject("Unknown activity kind")
            return
        }
        guard let state = contentState(from: call) else {
            call.reject("endsAt is required and must be an ISO-8601 timestamp")
            return
        }

        do {
            let activity = try Activity.request(
                attributes: TNRActivityAttributes(kind: kind, startedAt: Date()),
                content: .init(state: state, staleDate: state.endsAt),
                pushType: .token
            )

            // The token arrives asynchronously and can be re-issued at any time, so it is
            // pushed to the WebView as an event as well as returned once here.
            Task { [weak self] in
                for await tokenData in activity.pushTokenUpdates {
                    let token = tokenData.map { String(format: "%02x", $0) }.joined()
                    self?.notifyListeners(
                        "activityToken",
                        data: ["activityId": activity.id, "pushToken": token]
                    )
                }
            }

            call.resolve(["activityId": activity.id])
        } catch {
            call.reject("Could not start the activity", nil, error)
        }
        #else
        call.reject("ActivityKit is unavailable")
        #endif
    }

    @objc func update(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        guard #available(iOS 16.1, *) else {
            call.reject("Live Activities need iOS 16.1")
            return
        }
        guard let activityId = call.getString("activityId") else {
            call.reject("activityId is required")
            return
        }
        guard let state = contentState(from: call) else {
            call.reject("endsAt is required and must be an ISO-8601 timestamp")
            return
        }
        guard let activity = Self.activity(with: activityId) else {
            call.reject("No such activity")
            return
        }
        Task {
            await activity.update(.init(state: state, staleDate: state.endsAt))
            call.resolve()
        }
        #else
        call.reject("ActivityKit is unavailable")
        #endif
    }

    @objc func end(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        guard #available(iOS 16.1, *) else {
            call.reject("Live Activities need iOS 16.1")
            return
        }
        guard let activityId = call.getString("activityId"),
              let activity = Self.activity(with: activityId) else {
            // Already gone is the outcome the caller wanted.
            call.resolve()
            return
        }
        Task {
            await activity.end(nil, dismissalPolicy: .immediate)
            call.resolve()
        }
        #else
        call.resolve()
        #endif
    }

    @objc func endAll(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        guard #available(iOS 16.1, *) else {
            call.resolve()
            return
        }
        Task {
            for activity in Activity<TNRActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
        #else
        call.resolve()
        #endif
    }

    @objc func getPushToStartToken(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        guard #available(iOS 17.2, *) else {
            // Older systems can still run activities, they just cannot have one opened
            // remotely. Resolving empty keeps that a capability check, not an error.
            call.resolve([:])
            return
        }
        Task { [weak self] in
            var delivered = false
            for await tokenData in Activity<TNRActivityAttributes>.pushToStartTokenUpdates {
                let token = tokenData.map { String(format: "%02x", $0) }.joined()
                if !delivered {
                    delivered = true
                    call.resolve(["token": token])
                } else {
                    // Apple rotates this token; later values reach the server as events.
                    self?.notifyListeners("pushToStartToken", data: ["token": token])
                }
            }
        }
        #else
        call.resolve([:])
        #endif
    }

    // MARK: - Helpers

    #if canImport(ActivityKit)
    @available(iOS 16.1, *)
    private static func activity(with id: String) -> Activity<TNRActivityAttributes>? {
        Activity<TNRActivityAttributes>.activities.first { $0.id == id }
    }

    @available(iOS 16.1, *)
    private func contentState(from call: CAPPluginCall) -> TNRActivityAttributes.ContentState? {
        guard let endsAtRaw = call.getString("endsAt"),
              let endsAt = Self.parseDate(endsAtRaw) else { return nil }
        return .init(
            title: call.getString("title") ?? "TheNinja-RPG",
            subtitle: call.getString("subtitle"),
            endsAt: endsAt,
            progress: call.getDouble("progress")
        )
    }
    #endif

    /// `Date.toISOString()` includes milliseconds, which the plain formatter rejects.
    private static func parseDate(_ raw: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return withFraction.date(from: raw) ?? plain.date(from: raw)
    }
}
