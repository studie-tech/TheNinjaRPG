package com.theninjarpg.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;

/**
 * Keeps the soundtrack alive when the app is backgrounded, and puts transport controls on
 * the lock screen.
 *
 * The WebView does the playing; without a foreground service the system is free to freeze
 * the process the moment the app leaves the screen, which stops the audio. The MediaSession
 * is what makes the lock-screen and headset buttons work.
 *
 * Built on the platform MediaSession rather than media3 so the project needs no extra
 * dependency for what amounts to three buttons.
 */
public class TNRAudioService extends Service {

    static final String ACTION_START = "com.theninjarpg.app.AUDIO_START";
    static final String ACTION_STOP = "com.theninjarpg.app.AUDIO_STOP";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_ARTIST = "artist";

    private static final String CHANNEL_ID = "playback";
    private static final int NOTIFICATION_ID = 7001;

    /** Set by the plugin while it is loaded, so commands can reach the WebView. */
    static volatile RemoteCommandListener listener;

    interface RemoteCommandListener {
        void onRemoteCommand(String command);
    }

    private MediaSession session;
    private String title = "TheNinja-RPG";
    private String artist = "Seichi";

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        session = new MediaSession(this, "TNRAudio");
        session.setCallback(
            new MediaSession.Callback() {
                @Override
                public void onPlay() {
                    emit("play");
                }

                @Override
                public void onPause() {
                    emit("pause");
                }

                @Override
                public void onStop() {
                    emit("pause");
                }
            }
        );
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null) {
            if (intent.hasExtra(EXTRA_TITLE)) {
                title = intent.getStringExtra(EXTRA_TITLE);
            }
            if (intent.hasExtra(EXTRA_ARTIST)) {
                artist = intent.getStringExtra(EXTRA_ARTIST);
            }
        }
        setPlaybackState();
        startInForeground();
        // Not sticky: if the system kills us, the player has stopped listening anyway, and
        // silently restarting a music service is worse than not.
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void startInForeground() {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Declaring the type is mandatory from API 34; passing it earlier is harmless.
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildNotification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);

        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            builder.setContentIntent(
                PendingIntent.getActivity(
                    this,
                    0,
                    launch,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                )
            );
        }

        builder
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title)
            .setContentText(artist)
            .setOngoing(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP && session != null) {
            builder.setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()));
        }
        return builder.build();
    }

    private void setPlaybackState() {
        if (session == null) {
            return;
        }
        session.setPlaybackState(
            new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE)
                .setState(PlaybackState.STATE_PLAYING, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1.0f)
                .build()
        );
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        // Low importance and no badge: this notification exists to hold the transport
        // controls, not to get anyone's attention.
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Playback",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Shows the soundtrack controls while the app is in the background");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private void emit(String command) {
        RemoteCommandListener current = listener;
        if (current != null) {
            current.onRemoteCommand(command);
        }
    }

    static void start(Context context, String title, String artist) {
        Intent intent = new Intent(context, TNRAudioService.class).setAction(ACTION_START);
        if (title != null) {
            intent.putExtra(EXTRA_TITLE, title);
        }
        if (artist != null) {
            intent.putExtra(EXTRA_ARTIST, artist);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, TNRAudioService.class));
    }
}
