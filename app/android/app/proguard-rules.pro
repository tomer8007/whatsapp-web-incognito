# ProGuard rules for WAIncognito Android with Mozilla GeckoView

# Keep Mozilla GeckoView classes and native bindings
-keep class org.mozilla.geckoview.** { *; }
-keep interface org.mozilla.geckoview.** { *; }

# Keep application entrypoints and delegates
-keep class com.waincognito.app.** { *; }

# Keep AndroidX and Material components used dynamically
-keep class androidx.appcompat.** { *; }
-keep class com.google.android.material.** { *; }
