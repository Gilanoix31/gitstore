package com.gitstore.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GitStorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
