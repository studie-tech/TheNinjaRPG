package com.theninjarpg.app;

import android.app.Activity;
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
    /**
     * This instance's listener, kept so teardown can tell whether it is still the current
     * one. The field on the service is static and shared, and on an activity recreation
     * Android builds the replacement plugin before destroying the old one -- so the old
     * instance must not clear a listener its successor has already installed.
     */
    private TNRAudioService.RemoteCommandListener mine;

    @Override
    public void load() {
        mine = command -> {
            JSObject payload = new JSObject();
            payload.put("command", command);
            notifyListeners("remoteCommand", payload);
        };
        TNRAudioService.listener = mine;
    }

    @Override
    protected void handleOnDestroy() {
        // The service outlives the activity by design -- that is what keeps the soundtrack
        // playing while the app is backgrounded -- but nothing is left to control it once
        // the shell is gone, so the task being swiped away must take the notification with
        // it rather than leaving a permanent card with dead transport controls.
        //
        // Not when the activity is only being rebuilt, though. A configuration this
        // manifest does not claim -- a font size change, say -- destroys the activity and
        // creates a new one, in that order, and stopping the service in between would cut
        // the music off mid-song for something the player experiences as nothing at all.
        // The replacement re-registers its own listener in load().
        Activity activity = getActivity();
        boolean rebuilding = activity != null && activity.isChangingConfigurations();
        if (TNRAudioService.listener == mine) {
            TNRAudioService.listener = null;
            // `running` belongs to this plugin instance, so it is false after an Activity
            // recreation even though the service deliberately survived the old instance.
            // stopService is idempotent; use lifecycle state rather than that stale flag.
            if (!rebuilding) {
                TNRAudioService.stop(getContext());
                running = false;
            }
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void activate(PluginCall call) {
        // The system refuses a foreground service start from the background on Android 12+.
        // Reporting it lets the web side stop claiming background audio is on.
        if (!TNRAudioService.start(getContext(), title, artist)) {
            running = false;
            call.reject("The system would not allow background audio to start right now");
            return;
        }
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
            running = TNRAudioService.start(getContext(), title, artist);
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
