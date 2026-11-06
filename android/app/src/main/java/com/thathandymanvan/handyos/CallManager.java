package com.thathandymanvan.handyos;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;
import com.twilio.voice.Call;
import com.twilio.voice.CallException;
import com.twilio.voice.CallInvite;
import com.twilio.voice.CancelledCallInvite;

/**
 * Holds the one call the phone is dealing with: the invite while it rings, then the live call. The ringing screen and the buttons
 * in the notification, the in-app buttons and the Twilio callbacks all go through here, so they always agree.
 */
public final class CallManager {
    static final String CHANNEL_ID = "incoming_calls";
    static final int NOTIFICATION_ID = 4001;

    private static CallInvite invite;
    private static Call call;
    private static boolean muted = false;
    private static HandyCallPlugin plugin;

    private CallManager() {}

    static void attach(HandyCallPlugin p) {
        plugin = p;
    }

    private static void emit(String event, JSObject data) {
        if (plugin != null) plugin.emit(event, data);
    }

    /** What the screen should show right now. */
    static synchronized JSObject state() {
        JSObject s = new JSObject();
        if (call != null) {
            s.put("state", "connected");
            s.put("from", call.getFrom());
        } else if (invite != null) {
            s.put("state", "ringing");
            s.put("from", invite.getFrom());
            String parent = invite.getCustomParameters().get("parent");
            if (parent != null) s.put("parent", parent);
        } else {
            s.put("state", "idle");
        }
        s.put("muted", muted);
        return s;
    }

    // ---- an invite arrives (from the push message) ----
    static synchronized void onInvite(Context context, CallInvite ci) {
        invite = ci;
        showRingingNotification(context, ci);
        emit("state", state());
    }

    static synchronized void onCancelled(Context context, CancelledCallInvite cancelled) {
        if (invite != null && invite.getCallSid().equals(cancelled.getCallSid())) invite = null;
        cancelNotification(context);
        emit("state", state());
    }

    // ---- the person answers or declines ----
    static synchronized void answer(Context context) {
        if (invite == null) return;
        Context app = context.getApplicationContext();
        cancelNotification(app);
        AudioManager audio = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
        app.startForegroundService(new Intent(app, CallService.class));
        invite.accept(app, listener(app));
        emit("state", state());
    }

    static synchronized void decline(Context context) {
        if (invite != null) {
            invite.reject(context.getApplicationContext());
            invite = null;
        }
        cancelNotification(context);
        emit("state", state());
    }

    static synchronized void hangUp() {
        if (call != null) call.disconnect();
    }

    static synchronized void setMuted(boolean value) {
        muted = value;
        if (call != null) call.mute(value);
        emit("state", state());
    }

    private static Call.Listener listener(Context app) {
        return new Call.Listener() {
            @Override
            public void onRinging(Call c) {}

            @Override
            public void onConnectFailure(Call c, CallException e) {
                finish(app);
            }

            @Override
            public void onConnected(Call c) {
                synchronized (CallManager.class) {
                    call = c;
                    invite = null;
                }
                emit("state", state());
            }

            @Override
            public void onReconnecting(Call c, CallException e) {}

            @Override
            public void onReconnected(Call c) {}

            @Override
            public void onDisconnected(Call c, CallException e) {
                finish(app);
            }

            @Override
            public void onCallQualityWarningsChanged(Call c, java.util.Set<Call.CallQualityWarning> now, java.util.Set<Call.CallQualityWarning> before) {}
        };
    }

    private static synchronized void finish(Context app) {
        call = null;
        invite = null;
        muted = false;
        AudioManager audio = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        audio.setMode(AudioManager.MODE_NORMAL);
        app.stopService(new Intent(app, CallService.class));
        emit("state", state());
    }

    // ---- the ringing notification ----
    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Customer calls to the company number");
        ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIC).build());
        ch.enableVibration(true);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    private static void showRingingNotification(Context context, CallInvite ci) {
        ensureChannel(context);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        Intent open = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("incoming", true);
        Intent accept = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("incoming", true).putExtra("answer", true);
        Intent decline = new Intent(context, CallActionReceiver.class).setAction("DECLINE");
        PendingIntent openPi = PendingIntent.getActivity(context, 1, open, flags);
        PendingIntent acceptPi = PendingIntent.getActivity(context, 2, accept, flags);
        PendingIntent declinePi = PendingIntent.getBroadcast(context, 3, decline, flags);
        Notification n = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.sym_call_incoming)
                .setContentTitle("Incoming call")
                .setContentText(ci.getFrom())
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setTimeoutAfter(45_000)
                .setFullScreenIntent(openPi, true)
                .setContentIntent(openPi)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declinePi)
                .addAction(android.R.drawable.sym_action_call, "Answer", acceptPi)
                .build();
        n.flags |= Notification.FLAG_INSISTENT;
        context.getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, n);
    }

    static void cancelNotification(Context context) {
        context.getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
    }
}
