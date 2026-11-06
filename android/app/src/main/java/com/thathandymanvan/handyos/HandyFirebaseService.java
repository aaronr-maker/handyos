package com.thathandymanvan.handyos;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import com.twilio.voice.CallException;
import com.twilio.voice.CallInvite;
import com.twilio.voice.CancelledCallInvite;
import com.twilio.voice.MessageListener;
import com.twilio.voice.Voice;

import java.util.Map;

/** Twilio wakes the phone with a push message when a call comes in, even when the app is closed. */
public class HandyFirebaseService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (data.isEmpty()) return;
        Voice.handleMessage(this, data, new MessageListener() {
            @Override
            public void onCallInvite(@NonNull CallInvite callInvite) {
                CallManager.onInvite(getApplicationContext(), callInvite);
            }

            @Override
            public void onCancelledCallInvite(@NonNull CancelledCallInvite cancelledCallInvite, CallException callException) {
                CallManager.onCancelled(getApplicationContext(), cancelledCallInvite);
            }
        });
    }

    @Override
    public void onNewToken(@NonNull String token) {
        // the app registers the new token with Twilio the next time it opens
    }
}
