package com.theninjarpg.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Android half of app/src/libs/native/widgetBridge.ts. */
@CapacitorPlugin(name = "TNRWidgetSync")
public class TNRWidgetSyncPlugin extends Plugin {

    @PluginMethod
    public void sync(PluginCall call) {
        String snapshot = call.getString("snapshot");
        if (snapshot == null) {
            call.reject("A snapshot is required");
            return;
        }
        TNRSnapshotStore.save(getContext(), snapshot);
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        TNRSnapshotStore.clear(getContext());
        call.resolve();
    }
}
