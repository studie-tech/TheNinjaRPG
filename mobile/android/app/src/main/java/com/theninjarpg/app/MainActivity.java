package com.theninjarpg.app;

import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins have to be registered before super.onCreate builds the bridge.
        registerPlugin(TNRWidgetSyncPlugin.class);
        registerPlugin(TNRAudioSessionPlugin.class);
        registerPlugin(TNRLiveUpdatesPlugin.class);
        super.onCreate(savedInstanceState);

        // The bundled entry point handles cold-start outages. If a later navigation fails,
        // return to that same retry screen instead of leaving Android's raw WebView error.
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame() && !bridge.getHost().equals(request.getUrl().getHost())) {
                    view.loadUrl(bridge.getAppUrl());
                }
            }
        });

        // Cheap and idempotent, and it has to happen before the first push arrives:
        // a notification whose channel does not exist is dropped without a trace.
        TNRNotificationChannels.register(this);
    }
}
