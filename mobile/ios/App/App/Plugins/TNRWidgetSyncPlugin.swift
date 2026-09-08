import Capacitor
import Foundation
import WidgetKit

/// Writes the widget snapshot into the App Group and asks WidgetKit to redraw.
///
/// The web app calls this on every foreground, so the widgets stay right while the app is
/// closed and never have to make a network request of their own.
@objc(TNRWidgetSyncPlugin)
public class TNRWidgetSyncPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TNRWidgetSyncPlugin"
    public let jsName = "TNRWidgetSync"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    @objc func sync(_ call: CAPPluginCall) {
        guard let snapshot = call.getString("snapshot") else {
            call.reject("A snapshot is required")
            return
        }
        TNRSnapshotStore.save(json: snapshot)
        reloadWidgets()
        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        TNRSnapshotStore.clear()
        reloadWidgets()
        call.resolve()
    }

    private func reloadWidgets() {
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }
}
