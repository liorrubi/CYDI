package com.playcydi.cydi;

import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.android.installreferrer.api.ReferrerDetails;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The whole native half of Android install attribution: connect to Google Play, read
 * ReferrerDetails once, hand the three fields we use to JavaScript, disconnect.
 *
 * Deliberately policy-free. When to call this, whether the data is usable, which events
 * to emit and how to dedupe them all live in src/services/installReferrer.ts, where they
 * run under plain Node in the test suite. A native implementation of that policy would
 * have to reimplement the analytics envelope - installationId, sessionId, isInternal,
 * appVersion, appBuild - which is exactly what analytics.ts exists to own.
 *
 * Only three of the seven ReferrerDetails accessors are read. The click timestamps and
 * the instant-experience flag answer nothing we ask; see INSTALL_REFERRER_NOTES.md.
 */
@CapacitorPlugin(name = "InstallReferrer")
public class InstallReferrerPlugin extends Plugin {

    @PluginMethod
    public void getReferrerDetails(PluginCall call) {
        final InstallReferrerClient client = InstallReferrerClient.newBuilder(getContext()).build();
        try {
            client.startConnection(new InstallReferrerStateListener() {
                // startConnection can deliver the setup callback and a disconnect, and a
                // PluginCall may only be resolved once. Whichever arrives first wins.
                private boolean settled = false;

                @Override
                public void onInstallReferrerSetupFinished(int responseCode) {
                    if (settled) return;
                    settled = true;

                    JSObject result = new JSObject();
                    result.put("responseCode", responseCode);

                    if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
                        try {
                            ReferrerDetails details = client.getInstallReferrer();
                            // getInstallReferrer() and getInstallVersion() are both plain
                            // Bundle.getString with no default, so BOTH can be null - older
                            // Play Store builds omit install_version entirely. Passed through
                            // as null rather than coerced to "", so the TypeScript side can
                            // tell "Play said nothing" from "Play said empty".
                            result.put("referrer", details.getInstallReferrer());
                            result.put("installVersion", details.getInstallVersion());
                            // Bundle.getLong with no default: an absent timestamp reads as 0,
                            // indistinguishable from epoch 0. The caller maps 0 to "unknown".
                            result.put("installBeginTimestampSeconds", details.getInstallBeginTimestampSeconds());
                        } catch (Exception e) {
                            // Reached OK but the details call still failed - report it as the
                            // transient code so the caller retries rather than giving up.
                            result = new JSObject();
                            result.put("responseCode", InstallReferrerClient.InstallReferrerResponse.SERVICE_UNAVAILABLE);
                        }
                    }

                    endQuietly(client);
                    call.resolve(result);
                }

                @Override
                public void onInstallReferrerServiceDisconnected() {
                    // Only settles the call when it arrives BEFORE setup finished; otherwise
                    // it is the ordinary teardown of a connection we already read from.
                    if (settled) return;
                    settled = true;

                    JSObject result = new JSObject();
                    result.put("responseCode", InstallReferrerClient.InstallReferrerResponse.SERVICE_DISCONNECTED);
                    endQuietly(client);
                    call.resolve(result);
                }
            });
        } catch (Exception e) {
            // Play Store missing, service binding refused outright, or any other throw from
            // startConnection. Resolved, never rejected: a failed attribution lookup must not
            // surface as an error the app has to handle.
            endQuietly(client);
            JSObject result = new JSObject();
            result.put("responseCode", InstallReferrerClient.InstallReferrerResponse.SERVICE_UNAVAILABLE);
            call.resolve(result);
        }
    }

    private static void endQuietly(InstallReferrerClient client) {
        try {
            client.endConnection();
        } catch (Exception ignored) {
            // Already disconnected, or never connected. Nothing to do either way.
        }
    }
}
