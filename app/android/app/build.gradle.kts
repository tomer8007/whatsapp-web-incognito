plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val packageJsonFile = rootDir.resolve("../../package.json")
val appVersionName: String = if (packageJsonFile.exists()) {
    Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(packageJsonFile.readText())?.groupValues?.get(1) ?: "1.0.0"
} else "1.0.0"

val semverParts = appVersionName.split('.').mapNotNull { it.takeWhile { c -> c.isDigit() }.toIntOrNull() }
val appVersionCode = (semverParts.getOrElse(0) { 0 } * 10000) +
                     (semverParts.getOrElse(1) { 0 } * 100) +
                     semverParts.getOrElse(2) { 0 }

android {
    namespace = "com.waincognito.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.waincognito.app"
        minSdk = 24
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersionName

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Multi-ABI for physical devices (arm64) and Waydroid / emulators (x86_64)
        ndk {
            abiFilters.addAll(listOf("arm64-v8a", "x86_64", "armeabi-v7a"))
        }
    }

    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "x86_64", "armeabi-v7a")
            isUniversalApk = true
        }
    }

    androidResources {
        noCompress.addAll(listOf("html", "js", "css", "json", "png", "svg", "webp"))
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfig = signingConfigs.getByName("debug")
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
    implementation("org.mozilla.geckoview:geckoview:144.0.+")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
}
