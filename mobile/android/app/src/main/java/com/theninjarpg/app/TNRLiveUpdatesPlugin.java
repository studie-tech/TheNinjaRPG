package com.theninjarpg.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashMap;
import java.util.Map;

/**
 * Android's answer to Live Activities.
 *
 * Android 16 (API 36) added Notification.ProgressStyle, which renders a self-updating
 * progress card on the lock screen and a chip in the status bar. It is a different API
 * from ActivityKit rather than a port of it, so this shares only the shape of the calls
 * with the iOS plugin -- start, update, end -- which is what lets
 * app/src/libs/native/liveActivity.ts drive both.
 *
 * Below API 36 there is nothing equivalent, so the same content is posted as an ordinary
 * ongoing notification with a determinate progress bar. It degrades rather than failing.
 */
@CapacitorPlugin(name = "TNRLiveActivity")
public class TNRLiveUpdatesPlugin extends Plugin {

    private static final String CHANNEL_ID = "recovery";
    private final Map<String, Integer> activities = new HashMap<>();
    private int nextNotificationId = 8000;

    @PluginMethod
    public void start(PluginCall call) {
        String kind = call.getString("kind");
        if (kind == null) {
            call.reject("kind is required");
            return;
        }
        Long endsAt = parseEndsAt(call);
        if (endsAt == null) {
            call.reject("endsAtEpochMs is required");
            return;
        }

        String activityId = kind + "-" + nextNotificationId;
        int notificationId = nextNotificationId++;
        activities.put(activityId, notificationId);
        post(notificationId, call, endsAt);

        JSObject result = new JSObject();
        result.put("activityId", activityId);
        // No push token: Android updates these through ordinary FCM messages, so the
        // server needs nothing extra beyond the device token it already has.
        call.resolve(result);
    }

    @PluginMethod
    public void update(PluginCall call) {
        String activityId = call.getString("activityId");
        Integer notificationId = activityId == null ? null : activities.get(activityId);
        if (notificationId == null) {
            call.reject("No such activity");
            return;
        }
        Long endsAt = parseEndsAt(call);
        if (endsAt == null) {
            call.reject("endsAtEpochMs is required");
            return;
        }
        post(notificationId, call, endsAt);
        call.resolve();
    }

    @PluginMethod
    public void end(PluginCall call) {
        String activityId = call.getString("activityId");
        Integer notificationId = activityId == null ? null : activities.remove(activityId);
        if (notificationId != null) {
            manager().cancel(notificationId);
        }
        // Already gone is the outcome the caller wanted, so this never rejects.
        call.resolve();
    }

    @PluginMethod
    public void endAll(PluginCall call) {
        for (Integer notificationId : activities.values()) {
            manager().cancel(notificationId);
        }
        activities.clear();
        call.resolve();
    }

    @PluginMethod
    public void getPushToStartToken(PluginCall call) {
        // An iOS-only concept. Resolving empty keeps this a capability check on the web
        // side rather than an error to handle per platform.
        call.resolve(new JSObject());
    }

    private void post(int notificationId, PluginCall call, long endsAt) {
        Context context = getContext();
        String title = call.getString("title", "TheNinja-RPG");
        String subtitle = call.getString("subtitle", "");

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(context, CHANNEL_ID)
            : new Notification.Builder(context);

        builder
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setWhen(endsAt)
            // Lets the system render the remaining time and keep it ticking without us
            // posting an update every second.
            .setUsesChronometer(true)
            .setChronometerCountDown(true);

        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch != null) {
            builder.setContentIntent(
                PendingIntent.getActivity(
                    context,
                    notificationId,
                    launch,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                )
            );
        }

        Double progress = call.getDouble("progress");
        if (progress != null) {
            builder.setProgress(100, (int) Math.round(progress * 100), false);
        } else {
            // Time remaining is the progress; an indeterminate bar would just spin.
            builder.setProgress(0, 0, false);
        }

        manager().notify(notificationId, builder.build());
    }

    /**
     * Epoch milliseconds, not an ISO-8601 string.
     *
     * minSdkVersion is 24 and core library desugaring is not enabled, so java.time is not
     * available on API 24-25 -- referencing it there throws NoClassDefFoundError at
     * runtime. A number needs no date library at all, and the web side sends one.
     */
    private Long parseEndsAt(PluginCall call) {
        Double raw = call.getDouble("endsAtEpochMs");
        if (raw == null) {
            return null;
        }
        return raw.longValue();
    }

    private NotificationManager manager() {
        return (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
    }
}
