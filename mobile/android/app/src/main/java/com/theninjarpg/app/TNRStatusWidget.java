package com.theninjarpg.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Home screen widget showing health, chakra and stamina.
 *
 * Built on RemoteViews rather than Glance deliberately: Glance would pull Compose and the
 * Kotlin toolchain into a project that otherwise needs neither, and RemoteViews works
 * unchanged from the minimum SDK upward. The trade is that the layout is XML and progress
 * bars are the only chart primitive available -- which is all this widget needs.
 */
public class TNRStatusWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            manager.updateAppWidget(appWidgetId, buildViews(context));
        }
    }

    private RemoteViews buildViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_status);

        // Tapping anywhere opens the app. A widget that does nothing when tapped reads as
        // broken.
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch != null) {
            PendingIntent pending = PendingIntent.getActivity(
                context,
                0,
                launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            views.setOnClickPendingIntent(R.id.widget_root, pending);
        }

        String json = TNRSnapshotStore.load(context);
        if (json == null) {
            views.setTextViewText(R.id.widget_username, context.getString(R.string.widget_signed_out));
            views.setTextViewText(R.id.widget_level, "");
            setBar(views, R.id.widget_health, R.id.widget_health_label, "HP", 0, 0);
            setBar(views, R.id.widget_chakra, R.id.widget_chakra_label, "CP", 0, 0);
            setBar(views, R.id.widget_stamina, R.id.widget_stamina_label, "SP", 0, 0);
            return views;
        }

        try {
            JSONObject snapshot = new JSONObject(json);
            views.setTextViewText(R.id.widget_username, snapshot.optString("username", "Shinobi"));
            views.setTextViewText(R.id.widget_level, "Lv " + snapshot.optInt("level", 1));
            setBar(
                views,
                R.id.widget_health,
                R.id.widget_health_label,
                "HP",
                snapshot.optInt("curHealth"),
                snapshot.optInt("maxHealth")
            );
            setBar(
                views,
                R.id.widget_chakra,
                R.id.widget_chakra_label,
                "CP",
                snapshot.optInt("curChakra"),
                snapshot.optInt("maxChakra")
            );
            setBar(
                views,
                R.id.widget_stamina,
                R.id.widget_stamina_label,
                "SP",
                snapshot.optInt("curStamina"),
                snapshot.optInt("maxStamina")
            );
        } catch (JSONException error) {
            // A snapshot written by a newer web build we cannot parse is not worth
            // crashing the launcher over; the placeholder is shown instead.
            views.setTextViewText(R.id.widget_username, context.getString(R.string.widget_signed_out));
        }
        return views;
    }

    private void setBar(RemoteViews views, int barId, int labelId, String label, int current, int maximum) {
        int safeMax = Math.max(maximum, 1);
        views.setProgressBar(barId, safeMax, Math.min(current, safeMax), false);
        views.setTextViewText(labelId, label + " " + current + "/" + maximum);
    }
}
