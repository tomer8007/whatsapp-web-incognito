package com.waincognito.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.ProgressBar
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import org.mozilla.geckoview.AllowOrDeny
import org.mozilla.geckoview.GeckoResult
import org.mozilla.geckoview.GeckoSession
import org.mozilla.geckoview.GeckoSessionSettings
import org.mozilla.geckoview.GeckoView

class MainActivity : AppCompatActivity() {

    private lateinit var geckoView: GeckoView
    private lateinit var geckoSession: GeckoSession
    private lateinit var progressBar: ProgressBar

    private var pendingFilePrompt: GeckoSession.PromptDelegate.FilePrompt? = null
    private var pendingFileResult: GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? = null

    private var pendingMediaCallback: GeckoSession.PermissionDelegate.MediaCallback? = null
    private var pendingVideoSources: Array<out GeckoSession.PermissionDelegate.MediaSource>? = null
    private var pendingAudioSources: Array<out GeckoSession.PermissionDelegate.MediaSource>? = null

    private val backPressedCallback = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            geckoSession.goBack()
        }
    }

    private val filePickerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val prompt = pendingFilePrompt
        val geckResult = pendingFileResult
        pendingFilePrompt = null
        pendingFileResult = null

        if (prompt == null || geckResult == null) return@registerForActivityResult

        if (result.resultCode == RESULT_OK && result.data != null) {
            val data = result.data!!
            val uris = mutableListOf<Uri>()

            data.data?.let { uris.add(it) }
            data.clipData?.let { clip ->
                for (i in 0 until clip.itemCount) {
                    clip.getItemAt(i).uri?.let { uris.add(it) }
                }
            }

            if (uris.isNotEmpty()) {
                geckResult.complete(prompt.confirm(this, uris.toTypedArray()))
                return@registerForActivityResult
            }
        }
        geckResult.complete(prompt.dismiss())
    }

    private val mediaPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val callback = pendingMediaCallback
        val video = pendingVideoSources
        val audio = pendingAudioSources
        pendingMediaCallback = null
        pendingVideoSources = null
        pendingAudioSources = null

        if (callback == null) return@registerForActivityResult

        val audioGranted = permissions[Manifest.permission.RECORD_AUDIO] == true ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val cameraGranted = permissions[Manifest.permission.CAMERA] == true ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

        val selectedVideo = if (cameraGranted) video?.firstOrNull() else null
        val selectedAudio = if (audioGranted) audio?.firstOrNull() else null

        if (selectedVideo != null || selectedAudio != null) {
            callback.grant(selectedVideo, selectedAudio)
        } else {
            callback.reject()
        }
    }

    companion object {
        private const val TAG = "WAIncognito"
        private const val WHATSAPP_WEB_URL = "https://web.whatsapp.com/"
        private const val DESKTOP_UA =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"

        fun isInternalUri(uri: String): Boolean {
            return try {
                val parsed = Uri.parse(uri)
                val scheme = parsed.scheme?.lowercase() ?: ""
                val host = parsed.host?.lowercase() ?: ""

                when {
                    scheme == "blob" || scheme == "data" || scheme == "about" ||
                    scheme == "resource" || scheme == "moz-extension" -> true
                    (scheme == "https" || scheme == "http") &&
                    (host == "web.whatsapp.com" || host.endsWith(".web.whatsapp.com") ||
                     host == "whatsapp.com" || host.endsWith(".whatsapp.com")) -> true
                    else -> false
                }
            } catch (e: Exception) {
                false
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Edge-to-edge system bars
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)

        geckoView = findViewById(R.id.geckoview)
        progressBar = findViewById(R.id.page_progress)

        val rootLayout = findViewById<View>(R.id.root_layout)
        ViewCompat.setOnApplyWindowInsetsListener(rootLayout) { view, insets ->
            val statusBarInsets = insets.getInsets(WindowInsetsCompat.Type.statusBars())
            val navBarInsets = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
            val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
            val bottomInset = if (imeInsets.bottom > 0) imeInsets.bottom else navBarInsets.bottom
            view.setPadding(0, statusBarInsets.top, 0, bottomInset)
            insets
        }

        // Setup back pressed callback
        onBackPressedDispatcher.addCallback(this, backPressedCallback)

        // Request notification permission on Android 13+ if not granted
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 101)
            }
        }

        // Configure session with desktop mode, desktop viewport, and spoofed UA
        val settings = GeckoSessionSettings.Builder()
            .usePrivateMode(false)
            .userAgentMode(GeckoSessionSettings.USER_AGENT_MODE_DESKTOP)
            .userAgentOverride(DESKTOP_UA)
            .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_DESKTOP)
            .suspendMediaWhenInactive(false)
            .build()
        geckoSession = GeckoSession(settings)

        // Attach delegates
        geckoSession.navigationDelegate = NavigationHandler()
        geckoSession.progressDelegate = ProgressHandler()
        geckoSession.contentDelegate = ContentHandler()
        geckoSession.promptDelegate = PromptHandler()
        geckoSession.permissionDelegate = PermissionHandler()

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

    override fun onDestroy() {
        geckoSession.close()
        super.onDestroy()
    }

    // --- GeckoView Delegates ---

    private inner class NavigationHandler : GeckoSession.NavigationDelegate {
        override fun onCanGoBack(session: GeckoSession, canGoBack: Boolean) {
            runOnUiThread {
                backPressedCallback.isEnabled = canGoBack
            }
        }

        override fun onLoadRequest(
            session: GeckoSession,
            request: GeckoSession.NavigationDelegate.LoadRequest
        ): GeckoResult<AllowOrDeny>? {
            val uri = request.uri
            if (isInternalUri(uri)) {
                return GeckoResult.fromValue(AllowOrDeny.ALLOW)
            }

            try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(intent)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to open external link: $uri", e)
            }
            return GeckoResult.fromValue(AllowOrDeny.DENY)
        }
    }

    private inner class ProgressHandler : GeckoSession.ProgressDelegate {
        override fun onPageStart(session: GeckoSession, url: String) {
            runOnUiThread {
                progressBar.visibility = View.VISIBLE
                progressBar.progress = 5
            }
        }

        override fun onProgressChange(session: GeckoSession, progress: Int) {
            runOnUiThread {
                progressBar.visibility = if (progress in 1..99) View.VISIBLE else View.GONE
                progressBar.progress = progress
            }
        }

        override fun onPageStop(session: GeckoSession, success: Boolean) {
            runOnUiThread {
                progressBar.visibility = View.GONE
            }
        }
    }

    private inner class ContentHandler : GeckoSession.ContentDelegate {
        override fun onCrash(session: GeckoSession) {
            Log.e(TAG, "GeckoSession content process crashed. Reloading session...")
            runOnUiThread {
                session.loadUri(WHATSAPP_WEB_URL)
            }
        }
    }

    private inner class PromptHandler : GeckoSession.PromptDelegate {
        override fun onFilePrompt(
            session: GeckoSession,
            prompt: GeckoSession.PromptDelegate.FilePrompt
        ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
            pendingFilePrompt = prompt
            val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
            pendingFileResult = result

            val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "*/*"
                if (prompt.mimeTypes != null && prompt.mimeTypes!!.isNotEmpty()) {
                    putExtra(Intent.EXTRA_MIME_TYPES, prompt.mimeTypes)
                    if (prompt.mimeTypes!!.size == 1) {
                        type = prompt.mimeTypes!![0]
                    }
                }
                if (prompt.type == GeckoSession.PromptDelegate.FilePrompt.Type.MULTIPLE) {
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
            }

            try {
                filePickerLauncher.launch(Intent.createChooser(intent, "Choose Attachment"))
            } catch (e: Exception) {
                Log.e(TAG, "Failed to launch file picker", e)
                pendingFilePrompt = null
                pendingFileResult = null
                return GeckoResult.fromValue(prompt.dismiss())
            }

            return result
        }

        override fun onAlertPrompt(
            session: GeckoSession,
            prompt: GeckoSession.PromptDelegate.AlertPrompt
        ): GeckoResult<GeckoSession.PromptDelegate.PromptResponse>? {
            val result = GeckoResult<GeckoSession.PromptDelegate.PromptResponse>()
            runOnUiThread {
                MaterialAlertDialogBuilder(this@MainActivity)
                    .setTitle(prompt.title ?: "Alert")
                    .setMessage(prompt.message ?: "")
                    .setPositiveButton(android.R.string.ok) { _, _ ->
                        result.complete(prompt.dismiss())
                    }
                    .setOnCancelListener {
                        result.complete(prompt.dismiss())
                    }
                    .show()
            }
            return result
        }
    }

    private inner class PermissionHandler : GeckoSession.PermissionDelegate {
        override fun onContentPermissionRequest(
            session: GeckoSession,
            perm: GeckoSession.PermissionDelegate.ContentPermission
        ): GeckoResult<Int>? {
            if (isInternalUri(perm.uri)) {
                return GeckoResult.fromValue(GeckoSession.PermissionDelegate.ContentPermission.VALUE_ALLOW)
            }
            return GeckoResult.fromValue(GeckoSession.PermissionDelegate.ContentPermission.VALUE_DENY)
        }

        override fun onMediaPermissionRequest(
            session: GeckoSession,
            uri: String,
            video: Array<out GeckoSession.PermissionDelegate.MediaSource>?,
            audio: Array<out GeckoSession.PermissionDelegate.MediaSource>?,
            callback: GeckoSession.PermissionDelegate.MediaCallback
        ) {
            if (!isInternalUri(uri)) {
                callback.reject()
                return
            }

            val neededPerms = mutableListOf<String>()
            if (audio != null && audio.isNotEmpty() &&
                ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
            ) {
                neededPerms.add(Manifest.permission.RECORD_AUDIO)
            }
            if (video != null && video.isNotEmpty() &&
                ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
            ) {
                neededPerms.add(Manifest.permission.CAMERA)
            }

            if (neededPerms.isEmpty()) {
                callback.grant(video?.firstOrNull(), audio?.firstOrNull())
            } else {
                pendingMediaCallback = callback
                pendingVideoSources = video
                pendingAudioSources = audio
                mediaPermissionLauncher.launch(neededPerms.toTypedArray())
            }
        }
    }
}
