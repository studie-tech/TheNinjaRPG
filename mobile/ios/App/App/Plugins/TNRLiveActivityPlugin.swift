import ActivityKit
import Capacitor
import Foundation

/// Live Activities: the hospital, training and war countdowns on the Lock Screen and in
/// the Dynamic Island.
///
/// The device starts an activity and hands back a per-activity push token; the server then
/// drives updates over APNs with `apns-push-type: liveactivity`, so the countdown stays
/// right without the app running. The ActivityContent APIs need iOS 16.2, so SceneDelegate
/// registers the plugin only there.
@available(iOS 16.2, *)
@objc(TNRLiveActivityPlugin)
public class TNRLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TNRLiveActivityPlugin"
    public let jsName = "TNRLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endKind", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endAll", returnType: CAPPluginReturnPromise),
    ]

    @objc func start(_ call: CAPPluginCall) {
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

        // An activity of this kind outlives the process that started it, so after a cold
        // start the web side has no id for one that is still on the Lock Screen. Adopting
        // it instead of requesting a second keeps one card per kind and rebinds the push
        // token to the activity the player can actually see. Matching on kind is
        // deliberate: another kind's countdown is a separate card and must be left alone.
        //
        // Only a card that can still be driven, though. `.ended` and `.dismissed` ones
        // ignore every update, so adopting one would leave the player with a dead card and
        // no countdown for the stay that just began. `.stale` is adoptable and must be:
        // the content sets its own stale date to the recovery time, so every hospital
        // countdown goes stale the moment it reaches zero, which is the ordinary end of a
        // stay rather than a reason to start over.
        let sameKind = Activity<TNRActivityAttributes>.activities
            .filter { $0.attributes.kind == kind }
        let adoptable = sameKind.first {
            $0.activityState == .active || $0.activityState == .stale
        }

        Task { [weak self] in
            if let existing = adoptable {
                await existing.update(.init(state: state, staleDate: state.endsAt))
                self?.observeToken(of: existing)
                call.resolve(["activityId": existing.id])
                return
            }
            // Clear the dead cards first, or the new countdown appears beside a finished
            // one that nothing can remove.
            for finished in sameKind {
                await finished.end(nil, dismissalPolicy: .immediate)
            }
            do {
                let activity = try Activity.request(
                    attributes: TNRActivityAttributes(kind: kind, startedAt: Date()),
                    content: .init(state: state, staleDate: state.endsAt),
                    pushType: .token
                )
                self?.observeToken(of: activity)
                call.resolve(["activityId": activity.id])
            } catch {
                call.reject("Could not start the activity", nil, error)
            }
        }
    }

    /// Forward this activity's push token to the WebView.
    ///
    /// The token arrives asynchronously and can be re-issued at any time, so it is pushed
    /// as an event rather than only returned from `start`.
    private func observeToken(of activity: Activity<TNRActivityAttributes>) {
        Task { [weak self] in
            for await tokenData in activity.pushTokenUpdates {
                let token = tokenData.map { String(format: "%02x", $0) }.joined()
                self?.notifyListeners(
                    "activityToken",
                    data: ["activityId": activity.id, "pushToken": token]
                )
            }
        }
    }

    @objc func end(_ call: CAPPluginCall) {
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
    }

    @objc func endAll(_ call: CAPPluginCall) {
        Task {
            for activity in Activity<TNRActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }

    @objc func endKind(_ call: CAPPluginCall) {
        guard let kindRaw = call.getString("kind"),
              let kind = TNRActivityAttributes.Kind(rawValue: kindRaw) else {
            call.reject("Unknown activity kind")
            return
        }
        Task {
            for activity in Activity<TNRActivityAttributes>.activities
                where activity.attributes.kind == kind {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }

    // MARK: - Helpers

    private static func activity(with id: String) -> Activity<TNRActivityAttributes>? {
        Activity<TNRActivityAttributes>.activities.first { $0.id == id }
    }

    /// Epoch milliseconds, matching what the Android plugin takes and what the server
    /// sends in a Live Activity push. One numeric format across all three removes every
    /// question about which ISO variant a given decoder accepts.
    private func contentState(from call: CAPPluginCall) -> TNRActivityAttributes.ContentState? {
        guard let endsAtMs = call.getDouble("endsAtEpochMs") else { return nil }
        return .init(
            title: call.getString("title") ?? "TheNinja-RPG",
            subtitle: call.getString("subtitle"),
            endsAt: Date(timeIntervalSince1970: endsAtMs / 1000),
            progress: call.getDouble("progress")
        )
    }
}
