package com.thathandymanvan.handyos;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** The "Decline" button on the ringing notification. */
public class CallActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if ("DECLINE".equals(intent.getAction())) CallManager.decline(context);
    }
}
