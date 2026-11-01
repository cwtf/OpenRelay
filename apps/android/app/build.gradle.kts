import java.util.Properties
import javax.inject.Inject

plugins {
    id("com.android.application")
}

/**
 * Release signing comes from apps/android/keystore.properties (git-ignored):
 * storeFile (relative to apps/android/), storePassword, keyAlias, keyPassword.
 * Without it, release builds come out unsigned and debug builds are unaffected.
 */
val keystoreFile = rootProject.file("keystore.properties")
val keystore = Properties().apply {
    if (keystoreFile.isFile) keystoreFile.inputStream().use { load(it) }
}

android {
    namespace = "io.github.cwtf.openrelay"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.cwtf.openrelay"
        minSdk = 29
        targetSdk = 36
        versionCode = 3
        versionName = "0.3.0"
    }

    signingConfigs {
        if (keystoreFile.isFile) {
            create("release") {
                storeFile = rootProject.file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
        }
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.18.0")
    implementation("androidx.activity:activity:1.11.0")
}

/**
 * The shared build: reader.html, assets/ and content.js from the repo's dist/,
 * served at https://appassets.androidplatform.net/assets/openrelay/.
 * Run `npm run build` in the repo root first.
 */
abstract class CopyOpenRelay @Inject constructor(
    private val fs: FileSystemOperations,
) : DefaultTask() {
    @get:InputDirectory
    abstract val dist: DirectoryProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @TaskAction
    fun copy() {
        val source = dist.get().asFile
        check(source.resolve("reader.html").isFile && source.resolve("content.js").isFile) {
            "Missing $source/reader.html or content.js. Run `npm run build` in the repository root first."
        }
        fs.sync {
            from(source) { include("reader.html", "content.js", "assets/**") }
            into(outputDir.dir("openrelay"))
        }
    }
}

val copyOpenRelay = tasks.register<CopyOpenRelay>("copyOpenRelay") {
    dist.set(rootProject.layout.projectDirectory.dir("../../dist"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copyOpenRelay, CopyOpenRelay::outputDir)
    }
}
