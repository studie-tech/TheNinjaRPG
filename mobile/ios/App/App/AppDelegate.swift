import UIKit
import Capacitor

#if canImport(Sentry)
import Sentry
#endif

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        startCrashReporting()
        return true
    }

    /// Native crash reporting for the shell itself.
    ///
    /// JavaScript errors already reach Sentry through `@sentry/nextjs` running in the
    /// WebView; this covers what that cannot see — Swift crashes, and the memory
    /// terminations caused by WebView memory pressure.
    ///
    /// Guarded on `canImport` so a project whose Sentry package has not been resolved
    /// still builds. The DSN is public by design: it identifies the project and nothing
    /// else, which is why it also sits in the web bundle.
    private func startCrashReporting() {
        #if canImport(Sentry)
        SentrySDK.start { options in
            options.dsn = "https://c35c54f99b73b4a3b8a7e60936bc2967@o4507797256601600.ingest.de.sentry.io/4507797262958672"
            options.environment = "native-ios"
            // The WebView reports its own performance; duplicating it here would only
            // spend quota twice on the same session.
            options.tracesSampleRate = 0.05
            options.sendDefaultPii = false
            options.enableAppHangTracking = true
        }
        #endif
    }

    /// APNs hands the token to the app delegate, and `@capacitor/push-notifications`
    /// listens for it on `NotificationCenter` rather than implementing the callback
    /// itself. Without these two the plugin's `registration` event never fires, so no iOS
    /// device is ever registered and every push silently goes nowhere.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
