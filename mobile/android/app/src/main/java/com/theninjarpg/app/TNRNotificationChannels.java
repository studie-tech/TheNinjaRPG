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
 */
final class TNRNotificationChannels {

    /** Categories that should interrupt: something is happening to the player right now. */
    private static final List<String> HIGH_IMPORTANCE = Arrays.asList("combat", "war");

    private static final Channel[] CHANNELS = {
        new Channel("combat", "Battles", "Attacks, duels and battle results"),
        new Channel("recovery", "Recovery", "Leaving hospital and finished regeneration"),
        new Channel("training", "Training", "Completed training sessions"),
        new Channel("war", "Village wars", "War declarations, raids and shrine attacks"),
        new Channel("clan", "Clan and ANBU", "Clan requests and squad activity"),
        new Channel("trade", "Trades", "Auctions, bids and completed trades"),
        new Channel("social", "Social", "Messages, mentions and marriage"),
        new Channel("system", "Announcements", "Game news and server notices"),
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
            int importance = HIGH_IMPORTANCE.contains(channel.id)
                ? NotificationManager.IMPORTANCE_HIGH
                : NotificationManager.IMPORTANCE_DEFAULT;
            NotificationChannel created = new NotificationChannel(channel.id, channel.name, importance);
            created.setDescription(channel.description);
            created.setShowBadge(true);
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
