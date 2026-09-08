package com.theninjarpg.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import java.util.Objects;

/**
 * The player snapshot the web app writes for the home screen widgets.
 *
 * Kept as the raw JSON string produced by app/src/libs/native/widgetBridge.ts and parsed
 * where it is rendered, so adding a field needs no change here.
 */
final class TNRSnapshotStore {

    private static final String PREFS = "tnr_widget";
    private static final String KEY = "snapshot";

    private TNRSnapshotStore() {}

    static synchronized void save(Context context, String json) {
        prefs(context).edit().putString(KEY, json).apply();
        notifyWidgets(context);
    }

    static synchronized void clear(Context context) {
        prefs(context).edit().remove(KEY).apply();
        notifyWidgets(context);
    }

    static synchronized String load(Context context) {
        return prefs(context).getString(KEY, null);
    }

    /**
     * Persist a network refresh only if the app has not changed accounts since it began.
     * SharedPreferences updates its in-memory value before apply() returns, and the shared
     * monitor serializes this with save/clear, so an old response cannot restore a signed-
     * out player's token or overwrite a newer player's snapshot.
     */
    static synchronized boolean saveIfUnchanged(
        Context context,
        String expectedJson,
        String newJson
    ) {
        if (!Objects.equals(prefs(context).getString(KEY, null), expectedJson)) {
            return false;
        }
        prefs(context).edit().putString(KEY, newJson).apply();
        notifyWidgets(context);
        return true;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * Ask every placed widget to redraw. Broadcasting the ids rather than calling
     * notifyAppWidgetViewDataChanged means widgets that are not on a home screen cost
     * nothing.
     */
    private static void notifyWidgets(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, TNRStatusWidget.class);
        int[] ids = manager.getAppWidgetIds(provider);
        if (ids.length == 0) {
            return;
        }
        Intent intent = new Intent(context, TNRStatusWidget.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        context.sendBroadcast(intent);
    }
}
