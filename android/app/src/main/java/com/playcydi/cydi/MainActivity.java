package com.playcydi.cydi;

import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** Below this smallest width (dp) the device is a phone (or a folded foldable): portrait only. */
    private static final int TABLET_MIN_SMALLEST_WIDTH_DP = 600;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must run BEFORE super.onCreate: the bridge is built there, and a plugin
        // registered afterwards is not in it.
        registerPlugin(InstallReferrerPlugin.class);
        super.onCreate(savedInstanceState);
        applyOrientationPolicy(getResources().getConfiguration());
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // The manifest handles smallestScreenSize / screenLayout itself (no restart), so folding or unfolding a
        // foldable arrives here: re-decide for the new screen.
        applyOrientationPolicy(newConfig);
    }

    /**
     * 0.59.0: phones are portrait-only. A round's square canvas, its header and Done cannot fit the 320-412dp of
     * height a phone has in landscape. Tablets and unfolded foldables (smallest width >= 600dp) keep every
     * orientation, and so does split-screen / free-form (the system decides there). USER_PORTRAIT still follows the
     * user's rotation lock between the two portrait directions. Google's full-screen ad activities set their own
     * orientation and are not affected. Android 16 ignores orientation requests on large screens anyway.
     */
    private void applyOrientationPolicy(Configuration config) {
        boolean phone = config.smallestScreenWidthDp != Configuration.SMALLEST_SCREEN_WIDTH_DP_UNDEFINED
            && config.smallestScreenWidthDp < TABLET_MIN_SMALLEST_WIDTH_DP;
        int desired = phone && !isInMultiWindowMode()
            ? ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT
            : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        if (getRequestedOrientation() != desired) setRequestedOrientation(desired);
    }
}
