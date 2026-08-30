import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// Hosts the bridge and registers the plugins that live in this target.
///
/// Capacitor only auto-registers the classes `cap sync` writes into
/// `capacitor.config.json`, which it builds from the installed npm packages. Plugins
/// compiled into the app itself are never in that list, so without this override every
/// call to them fails at the bridge and the widgets, Live Activities, audio session and
/// Sign in with Apple are all dead. `registerPluginInstance` is the supported route and,
/// unlike `registerPluginType`, is not skipped while auto-registration is on.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TNRWidgetSyncPlugin())
        bridge?.registerPluginInstance(TNRAudioSessionPlugin())
        bridge?.registerPluginInstance(TNRLiveActivityPlugin())
        bridge?.registerPluginInstance(TNRAppleAuthPlugin())
    }
}
