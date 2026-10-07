plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.waincognito.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.waincognito.app"
        minSdk = 24
        targetSdk = 35
        versionCode = 20595
        versionName = "2.5.95"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Multi-ABI for physical devices (arm64) and Waydroid / emulators (x86_64)
        ndk {
            abiFilters.addAll(listOf("arm64-v8a", "x86_64", "armeabi-v7a"))
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            applicationIdSuffix = ".debug"
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    // Mozilla GeckoView engine
    implementation("org.mozilla.geckoview:geckoview:135.0.+")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
}
