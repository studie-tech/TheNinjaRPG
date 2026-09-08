package com.theninjarpg.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins have to be registered before super.onCreate builds the bridge.
        registerPlugin(TNRWidgetSyncPlugin.class);
        registerPlugin(TNRAudioSessionPlugin.class);
        registerPlugin(TNRLiveUpdatesPlugin.class);
        super.onCreate(savedInstanceState);

        // Cheap and idempotent, and it has to happen before the first push arrives:
        // a notification whose channel does not exist is dropped without a trace.
        TNRNotificationChannels.register(this);
    }
}
