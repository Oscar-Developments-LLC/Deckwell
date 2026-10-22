plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing comes from environment variables (set as GitHub secrets in CI).
// Without them, release builds fall back to the debug key so local builds still work.
val ksPath: String? = System.getenv("DECKWELL_KEYSTORE")

android {
    namespace = "com.oscardevelopments.deckwell"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.oscardevelopments.deckwell"
        versionCode = 10000
        versionName = "1.0.0"
    }

    // Two builds from one codebase. No AndroidX anywhere: plain framework APIs only.
    flavorDimensions += "platform"
    productFlavors {
        create("legacy") {
            // Old tablets such as the Kindle Fire HDX (Fire OS 4 = Android 4.4, API 19). Sideload only.
            dimension = "platform"
            minSdk = 19
            targetSdk = 22
            applicationIdSuffix = ".legacy"
            versionNameSuffix = "-legacy"
        }
        create("current") {
            // Android 8.0+ phones and tablets. This is the Play Store build.
            dimension = "platform"
            minSdk = 26
            targetSdk = 35
        }
    }

    signingConfigs {
        create("release") {
            if (ksPath != null) {
                storeFile = file(ksPath)
                storePassword = System.getenv("DECKWELL_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("DECKWELL_KEY_ALIAS")
                keyPassword = System.getenv("DECKWELL_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (ksPath != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions { jvmTarget = "1.8" }
    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation("org.jetbrains.kotlin:kotlin-stdlib:2.0.21")
}

android.testOptions.unitTests.isIncludeAndroidResources = true
dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
}
tasks.withType<Test>().configureEach {
    systemProperty("layout.json", rootProject.file("../shared/sample-layout.json").absolutePath)
    systemProperty("render.out", rootProject.file("../shared/render").absolutePath)
    systemProperty("pairing.vector", rootProject.file("../shared/pairing-vector.json").absolutePath)
}
