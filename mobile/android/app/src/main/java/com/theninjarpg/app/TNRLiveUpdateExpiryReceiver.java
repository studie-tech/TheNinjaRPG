package com.theninjarpg.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Removes an ongoing countdown at its own deadline, even after the app process exits. */
public class TNRLiveUpdateExpiryReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!TNRLiveUpdatesPlugin.EXPIRY_ACTION.equals(intent.getAction())) {
            return;
        }
        String activityId = intent.getStringExtra(TNRLiveUpdatesPlugin.EXTRA_ACTIVITY_ID);
        int notificationId = intent.getIntExtra(
            TNRLiveUpdatesPlugin.EXTRA_NOTIFICATION_ID,
            -1
        );
        if (activityId == null || notificationId < 0) {
            return;
        }

        NotificationManager manager =
            (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.cancel(notificationId);
        }
        context
            .getSharedPreferences(TNRLiveUpdatesPlugin.PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(activityId)
            .apply();
    }
}
