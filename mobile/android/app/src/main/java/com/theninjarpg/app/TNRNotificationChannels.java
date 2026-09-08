package com.theninjarpg.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Notification channels, one per push category.
 *
 * Channels have been mandatory since Android 8, and a notification sent to a channel that
 * does not exist is dropped silently. The ids here must match PUSH_CATEGORIES in
 * app/drizzle/constants.ts, because the server sends the category as the FCM
 * channel_id -- adding a category there means adding it here.
 *
 * Having one channel per category is also what makes the in-app toggles and the OS
 * notification settings agree: muting "Village wars" in either place mutes the same thing.
 *
 * The one channel that is not a category is LIVE_UPDATES_CHANNEL, which carries the
 * ongoing countdown cards this app posts locally rather than anything the server sends.
 */
final class TNRNotificationChannels {

    /** Categories that should interrupt: something is happening to the player right now. */
    private static final List<String> HIGH_IMPORTANCE = Arrays.asList("combat", "war");

    /**
     * The ongoing countdown cards, which are a status display rather than an alert.
     *
     * Not a push category -- the server never targets it -- so it carries no badge and
     * makes no sound. Posting a hospital countdown to "recovery" would chime and badge
     * every time the player is hospitalised, and again on every update.
     */
    static final String LIVE_UPDATES_CHANNEL = "live";

    private static final Channel[] CHANNELS = {
        new Channel("combat", "Battles", "Attacks, duels and battle results"),
        new Channel("recovery", "Recovery", "Leaving hospital and finished regeneration"),
        new Channel("training", "Training", "Completed training sessions"),
        new Channel("war", "Village wars", "War declarations, raids and shrine attacks"),
        new Channel("clan", "Clan and ANBU", "Clan requests and squad activity"),
        new Channel("trade", "Trades", "Auctions, bids and completed trades"),
        new Channel("social", "Social", "Messages, mentions and marriage"),
        new Channel("system", "Announcements", "Game news and server notices"),
        new Channel(LIVE_UPDATES_CHANNEL, "Ongoing activity", "Hospital, training and war countdowns"),
    };

    private TNRNotificationChannels() {}

    static void register(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        List<NotificationChannel> channels = new ArrayList<>(CHANNELS.length);
        for (Channel channel : CHANNELS) {
            boolean isLive = LIVE_UPDATES_CHANNEL.equals(channel.id);
            int importance;
            if (isLive) {
                importance = NotificationManager.IMPORTANCE_LOW;
            } else if (HIGH_IMPORTANCE.contains(channel.id)) {
                importance = NotificationManager.IMPORTANCE_HIGH;
            } else {
                importance = NotificationManager.IMPORTANCE_DEFAULT;
            }
            NotificationChannel created = new NotificationChannel(channel.id, channel.name, importance);
            created.setDescription(channel.description);
            created.setShowBadge(!isLive);
            channels.add(created);
        }
        // createNotificationChannels is idempotent: an existing channel keeps whatever
        // importance the player chose, which is exactly the behaviour we want.
        manager.createNotificationChannels(channels);
    }

    private static final class Channel {
        final String id;
        final String name;
        final String description;

        Channel(String id, String name, String description) {
            this.id = id;
            this.name = name;
            this.description = description;
        }
    }
}
