package com.waincognito.app

import android.app.Application
import org.mozilla.geckoview.GeckoRuntime
import org.mozilla.geckoview.GeckoRuntimeSettings

class WAIncognitoApp : Application() {
    companion object {
        lateinit var geckoRuntime: GeckoRuntime
            private set
    }

    override fun onCreate() {
        super.onCreate()
        val settings = GeckoRuntimeSettings.Builder()
            .javaScriptEnabled(true)
            .consoleOutput(true)
            .build()
        geckoRuntime = GeckoRuntime.create(this, settings)
    }
}
