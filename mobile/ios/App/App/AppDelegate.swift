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
    /// terminations the three.js scenes are the likeliest cause of.
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

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
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
