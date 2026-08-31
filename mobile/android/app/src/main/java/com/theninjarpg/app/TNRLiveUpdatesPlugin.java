package com.theninjarpg.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Map;

/**
 * Android's answer to Live Activities.
 *
 * Shares only the shape of the calls with the iOS plugin -- start, update, end -- which is
 * what lets app/src/libs/native/liveActivity.ts drive both. It is not a port of ActivityKit.
 *
 * Every supported release posts the countdown the same way: an ongoing notification with a
 * determinate progress bar, on its own low-importance channel so it never makes a sound.
 * Android 16 (API 36) added Notification.ProgressStyle, which would render this as a
 * lock-screen card and a status-bar chip instead; adopting it is left for when the app
 * compiles against API 36, and until then the notification is what every release gets.
 */
@CapacitorPlugin(name = "TNRLiveActivity")
public class TNRLiveUpdatesPlugin extends Plugin {

    private static final String CHANNEL_ID = TNRNotificationChannels.LIVE_UPDATES_CHANNEL;
    static final String PREFS = "tnr_live_updates";
    private static final String KEY_NEXT_ID = "nextNotificationId";
    private static final int FIRST_NOTIFICATION_ID = 8000;
    static final String EXPIRY_ACTION = "com.theninjarpg.app.EXPIRE_LIVE_UPDATE";
    static final String EXTRA_ACTIVITY_ID = "activityId";
    static final String EXTRA_NOTIFICATION_ID = "notificationId";

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

        // A notification of this kind outlives the process that posted it, so after a
        // cold start the web side has no id for one that is still on screen. Reusing it
        // keeps a single card per kind; posting under the same id replaces its contents.
        // Without this, every relaunch during a hospital stay leaves another ongoing
        // notification behind that nothing holds an id for any more.
        String activityId = existingActivityFor(kind);
        int notificationId;
        if (activityId != null) {
            notificationId = notificationIdFor(activityId);
        } else {
            notificationId = nextNotificationId();
            activityId = kind + "-" + notificationId;
            rememberActivity(activityId, notificationId);
        }
        post(notificationId, activityId, call, endsAt);

        JSObject result = new JSObject();
        result.put("activityId", activityId);
        // Android owns the countdown and its expiry locally, so there is no ActivityKit
        // push token to register with the server.
        call.resolve(result);
    }

    @PluginMethod
    public void update(PluginCall call) {
        String activityId = call.getString("activityId");
        Integer notificationId = activityId == null ? null : notificationIdFor(activityId);
        if (notificationId == null) {
            call.reject("No such activity");
            return;
        }
        Long endsAt = parseEndsAt(call);
        if (endsAt == null) {
            call.reject("endsAtEpochMs is required");
            return;
        }
        post(notificationId, activityId, call, endsAt);
        call.resolve();
    }

    @PluginMethod
    public void end(PluginCall call) {
        String activityId = call.getString("activityId");
        Integer notificationId = activityId == null ? null : forgetActivity(activityId);
        if (notificationId != null) {
            cancelExpiry(activityId, notificationId);
            manager().cancel(notificationId);
        }
        // Already gone is the outcome the caller wanted, so this never rejects.
        call.resolve();
    }

    @PluginMethod
    public void endAll(PluginCall call) {
        SharedPreferences prefs = prefs();
        for (Map.Entry<String, ?> entry : prefs.getAll().entrySet()) {
            if (KEY_NEXT_ID.equals(entry.getKey())) {
                continue;
            }
            if (entry.getValue() instanceof Integer) {
                int notificationId = (Integer) entry.getValue();
                cancelExpiry(entry.getKey(), notificationId);
                manager().cancel(notificationId);
            }
        }
        int nextId = prefs.getInt(KEY_NEXT_ID, FIRST_NOTIFICATION_ID);
        prefs.edit().clear().putInt(KEY_NEXT_ID, nextId).apply();
        call.resolve();
    }

    @PluginMethod
    public void getPushToStartToken(PluginCall call) {
        // An iOS-only concept. Resolving empty keeps this a capability check on the web
        // side rather than an error to handle per platform.
        call.resolve(new JSObject());
    }

    private void post(int notificationId, String activityId, PluginCall call, long endsAt) {
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

        // API 26+ lets NotificationManager enforce the same deadline itself. The alarm
        // below covers API 24-25 and is also a belt-and-braces cleanup if notification
        // timeout delivery is delayed by an OEM.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder.setTimeoutAfter(Math.max(0, endsAt - System.currentTimeMillis()));
        }

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
        scheduleExpiry(activityId, notificationId, endsAt);
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

    private PendingIntent expiryIntent(String activityId, int notificationId) {
        Intent intent = new Intent(getContext(), TNRLiveUpdateExpiryReceiver.class)
            .setAction(EXPIRY_ACTION)
            .putExtra(EXTRA_ACTIVITY_ID, activityId)
            .putExtra(EXTRA_NOTIFICATION_ID, notificationId);
        return PendingIntent.getBroadcast(
            getContext(),
            notificationId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void scheduleExpiry(String activityId, int notificationId, long endsAt) {
        AlarmManager alarms = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) {
            return;
        }
        alarms.setAndAllowWhileIdle(
            AlarmManager.RTC_WAKEUP,
            Math.max(System.currentTimeMillis(), endsAt),
            expiryIntent(activityId, notificationId)
        );
    }

    private void cancelExpiry(String activityId, int notificationId) {
        AlarmManager alarms = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        if (alarms != null) {
            alarms.cancel(expiryIntent(activityId, notificationId));
        }
    }

    /**
     * The activity-to-notification mapping lives in SharedPreferences rather than in a
     * field.
     *
     * Android keeps posted notifications outside the app process, so after the process is
     * recreated an in-memory map would leave update() rejecting ids that are still on
     * screen, and end() with no id to cancel -- an ongoing notification nothing can
     * remove.
     */
    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private int nextNotificationId() {
        SharedPreferences prefs = prefs();
        int next = prefs.getInt(KEY_NEXT_ID, FIRST_NOTIFICATION_ID);
        prefs.edit().putInt(KEY_NEXT_ID, next + 1).apply();
        return next;
    }

    /**
     * The stored activity id for this kind, or null when none is live.
     *
     * Ids are "kind-notificationId", so the prefix identifies the kind. KEY_NEXT_ID is the
     * allocator's own counter and is not an activity.
     *
     * Any further entries for the same kind are cancelled and forgotten on the way past.
     * There should never be more than one, but a build installed over one that stacked
     * them would otherwise leave ongoing notifications on screen that nothing holds an id
     * for and the player cannot swipe away.
     */
    private String existingActivityFor(String kind) {
        String prefix = kind + "-";
        String found = null;
        SharedPreferences.Editor editor = prefs().edit();
        boolean cancelled = false;
        for (Map.Entry<String, ?> entry : prefs().getAll().entrySet()) {
            String key = entry.getKey();
            if (KEY_NEXT_ID.equals(key)
                || !key.startsWith(prefix)
                || !(entry.getValue() instanceof Integer)) {
                continue;
            }
            if (found == null) {
                found = key;
            } else {
                int notificationId = (Integer) entry.getValue();
                cancelExpiry(key, notificationId);
                manager().cancel(notificationId);
                editor.remove(key);
                cancelled = true;
            }
        }
        if (cancelled) {
            editor.apply();
        }
        return found;
    }

    private void rememberActivity(String activityId, int notificationId) {
        prefs().edit().putInt(activityId, notificationId).apply();
    }

    private Integer notificationIdFor(String activityId) {
        SharedPreferences prefs = prefs();
        return prefs.contains(activityId) ? prefs.getInt(activityId, -1) : null;
    }

    private Integer forgetActivity(String activityId) {
        Integer notificationId = notificationIdFor(activityId);
        if (notificationId != null) {
            prefs().edit().remove(activityId).apply();
        }
        return notificationId;
    }
}
