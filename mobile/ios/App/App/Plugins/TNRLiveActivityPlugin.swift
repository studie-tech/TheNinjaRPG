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
            call.reject("endsAtEpochMs is required")
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
            call.reject("endsAtEpochMs is required")
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
        // pushToStartTokenUpdates never completes, and on a build where APNs registration
        // has not finished it may never yield either. Without the timeout the JavaScript
        // promise would stay pending for the life of the process, holding on to `call`.
        let delivery = TokenDelivery(call: call)
        Task { [weak self] in
            for await tokenData in Activity<TNRActivityAttributes>.pushToStartTokenUpdates {
                let token = tokenData.map { String(format: "%02x", $0) }.joined()
                if await delivery.deliver(token) { continue }
                // Apple rotates this token; later values reach the server as events.
                self?.notifyListeners("pushToStartToken", data: ["token": token])
            }
        }
        Task {
            try? await Task.sleep(nanoseconds: 10 * 1_000_000_000)
            await delivery.timeout()
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

    /// Epoch milliseconds, matching what the Android plugin takes and what the server
    /// sends in a Live Activity push. One numeric format across all three removes every
    /// question about which ISO variant a given decoder accepts.
    @available(iOS 16.1, *)
    private func contentState(from call: CAPPluginCall) -> TNRActivityAttributes.ContentState? {
        guard let endsAtMs = call.getDouble("endsAtEpochMs") else { return nil }
        return .init(
            title: call.getString("title") ?? "TheNinja-RPG",
            subtitle: call.getString("subtitle"),
            endsAt: Date(timeIntervalSince1970: endsAtMs / 1000),
            progress: call.getDouble("progress")
        )
    }
    #endif
}

/// Serialises the first-token hand-off between the token stream and the timeout, so the
/// call is resolved exactly once from whichever arrives first.
private actor TokenDelivery {
    private var call: CAPPluginCall?

    init(call: CAPPluginCall) {
        self.call = call
    }

    /// Returns true when this token was the one that resolved the call.
    func deliver(_ token: String) -> Bool {
        guard let pending = call else { return false }
        call = nil
        pending.resolve(["token": token])
        return true
    }

    /// Resolving empty rather than rejecting keeps this a capability check on the web
    /// side, matching how an iOS version below 17.2 is reported.
    func timeout() {
        guard let pending = call else { return }
        call = nil
        pending.resolve([:])
    }
}
