plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    namespace = "com.aura.automotive"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.aura.automotive"
        minSdk = 29
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }
}


kotlin { jvmToolchain(17) }

dependencies {
    implementation("androidx.webkit:webkit:1.10.0")
}

val buildPactWeb by tasks.registering(Exec::class) {
    workingDir("../../web-simulator")
    commandLine("npm", "run", "build:pact")
}
val bundlePactAssets by tasks.registering(Sync::class) {
    dependsOn(buildPactWeb)
    from("../../web-simulator/dist-pact")
    into(layout.buildDirectory.dir("generated/pact-assets/pact"))
}
android.sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/pact-assets"))
tasks.named("preBuild") { dependsOn(bundlePactAssets) }
