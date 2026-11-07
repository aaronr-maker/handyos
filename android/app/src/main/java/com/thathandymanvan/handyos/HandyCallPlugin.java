package com.thathandymanvan.handyos;

import android.Manifest;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.messaging.FirebaseMessaging;
import com.twilio.voice.RegistrationException;
import com.twilio.voice.RegistrationListener;
import com.twilio.voice.Voice;

/** The bridge between the app's screens and the phone's calling: sign up for calls, answer, decline, hang up, mute. */
@CapacitorPlugin(
        name = "HandyCall",
        permissions = {
                @Permission(strings = {Manifest.permission.RECORD_AUDIO}, alias = "microphone"),
                @Permission(strings = {Manifest.permission.POST_NOTIFICATIONS}, alias = "notifications")
        })
public class HandyCallPlugin extends Plugin {
    @Override
    public void load() {
        CallManager.attach(this);
    }

    void emit(String event, JSObject data) {
        notifyListeners(event, data, true);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        requestAllPermissions(call, "permissionsDone");
    }

    @PermissionCallback
    private void permissionsDone(PluginCall call) {
        JSObject r = new JSObject();
        r.put("microphone", getPermissionState("microphone").toString());
        r.put("notifications", getPermissionState("notifications").toString());
        call.resolve(r);
    }

    /** Signs this phone up with Twilio for calls to the signed-in person, using the pass from the server. */
    @PluginMethod
    public void register(PluginCall call) {
        final String token = call.getString("token");
        if (token == null || token.isEmpty()) {
            call.reject("No calling pass was given.");
            return;
        }
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful() || task.getResult() == null) {
                call.reject("The phone could not get its push address (is google-services.json in the build?).");
                return;
            }
            Voice.register(token, Voice.RegistrationChannel.FCM, task.getResult(), new RegistrationListener() {
                @Override
                public void onRegistered(String accessToken, String fcmToken) {
                    call.resolve();
                }

                @Override
                public void onError(RegistrationException error, String accessToken, String fcmToken) {
                    call.reject("Twilio would not register this phone: " + error.getMessage());
                }
            });
        });
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(CallManager.state());
    }

    @PluginMethod
    public void answer(PluginCall call) {
        CallManager.answer(getContext());
        call.resolve();
    }

    @PluginMethod
    public void decline(PluginCall call) {
        CallManager.decline(getContext());
        call.resolve();
    }

    @PluginMethod
    public void hangUp(PluginCall call) {
        CallManager.hangUp();
        call.resolve();
    }

    @PluginMethod
    public void mute(PluginCall call) {
        CallManager.setMuted(Boolean.TRUE.equals(call.getBoolean("muted", true)));
        call.resolve();
    }
}
