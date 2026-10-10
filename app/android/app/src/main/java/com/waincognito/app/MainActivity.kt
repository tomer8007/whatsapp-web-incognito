package com.waincognito.app

import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import androidx.appcompat.app.AppCompatActivity
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.GeckoView

class MainActivity : AppCompatActivity() {

    private lateinit var geckoView: GeckoView
    private lateinit var geckoSession: GeckoSession

    companion object {
        private const val TAG = "WAIncognito"
        private const val WHATSAPP_WEB_URL = "https://web.whatsapp.com/"
        private const val DESKTOP_UA =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        geckoView = findViewById(R.id.geckoview)
        // Configure session with desktop mode and spoofed UA to prevent mobile redirects
        val settings = GeckoSessionSettings.Builder()
            .usePrivateMode(false)
            .userAgentMode(GeckoSessionSettings.USER_AGENT_MODE_DESKTOP)
            .userAgentOverride(DESKTOP_UA)
            .suspendMediaWhenInactive(false)
            .build()
        geckoSession = GeckoSession(settings)

        val runtime = WAIncognitoApp.geckoRuntime
        geckoSession.open(runtime)
        geckoView.setSession(geckoSession)

        // Register built-in WAIncognito WebExtension from assets
        Log.i(TAG, "Registering extension...")
        runtime.webExtensionController.ensureBuiltIn("resource://android/assets/waincognito/", "waincognito@wa-incognito.com")
            .accept(
                org.mozilla.geckoview.GeckoResult.Consumer { extension ->
                    Log.i(TAG, "WAIncognito extension registered: ${extension?.id}")
                    runOnUiThread {
                        Log.i(TAG, "Loading URI after extension install...")
                        geckoSession.loadUri(WHATSAPP_WEB_URL)
                    }
                },
                org.mozilla.geckoview.GeckoResult.Consumer { throwable ->
                    Log.e(TAG, "Failed to register WAIncognito extension", throwable)
                    runOnUiThread {
                        Log.i(TAG, "Loading URI anyway...")
                        geckoSession.loadUri(WHATSAPP_WEB_URL)
                    }
                }
            )
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // Check if page can navigate back or if chat is open
            geckoSession.historyDelegate?.let {
                geckoSession.goBack()
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        geckoSession.close()
        super.onDestroy()
    }
}
