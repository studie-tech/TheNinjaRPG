package com.theninjarpg.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Android half of app/src/libs/native/audioSession.ts. */
@CapacitorPlugin(name = "TNRAudioSession")
public class TNRAudioSessionPlugin extends Plugin {

    private String title = "TheNinja-RPG";
    private String artist = "Seichi";
    private boolean running = false;

    @Override
    public void load() {
        TNRAudioService.listener = command -> {
            JSObject payload = new JSObject();
            payload.put("command", command);
            notifyListeners("remoteCommand", payload);
        };
    }

    @Override
    protected void handleOnDestroy() {
        // The service outlives the activity, so a stale listener would hold a reference to
        // a dead bridge.
        TNRAudioService.listener = null;
        super.handleOnDestroy();
    }

    @PluginMethod
    public void activate(PluginCall call) {
        TNRAudioService.start(getContext(), title, artist);
        running = true;
        call.resolve();
    }

    @PluginMethod
    public void deactivate(PluginCall call) {
        TNRAudioService.stop(getContext());
        running = false;
        call.resolve();
    }

    @PluginMethod
    public void setNowPlaying(PluginCall call) {
        title = call.getString("title", title);
        artist = call.getString("artist", artist);
        // Only restart the service if it is already showing something, otherwise setting
        // metadata would start background playback the player never asked for.
        if (running) {
            TNRAudioService.start(getContext(), title, artist);
        }
        call.resolve();
    }

    @PluginMethod
    public void setRemoteCommandsEnabled(PluginCall call) {
        // The MediaSession owns the controls on Android and is created with the service,
        // so there is nothing to toggle separately. Accepting the call keeps the web API
        // identical across platforms.
        call.resolve();
    }
}
