package io.github.cwtf.openrelay

import android.Manifest
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Message
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ScriptHandler
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

private const val TAG = "OpenRelay"
private const val READER_HOST = "appassets.androidplatform.net"
private const val READER_ORIGIN = "https://$READER_HOST"
private const val READER_URL = "$READER_ORIGIN/assets/openrelay/reader.html"
/** The reader without Reddit, showing the posts saved for offline reading. */
private const val OFFLINE_URL = "$READER_URL#offline"
private val REDDIT_ORIGINS =
    setOf("https://www.reddit.com", "https://old.reddit.com", "https://reddit.com")
/** Reddit's image hosts, as MEDIA_HOSTS in src/hosts/types.ts. */
private val MEDIA_HOSTS = setOf(
    "i.redd.it",
    "preview.redd.it",
    "external-preview.redd.it",
    "a.thumbs.redditmedia.com",
    "b.thumbs.redditmedia.com",
)
private const val MEDIA_MAX_BYTES = 10 * 1024 * 1024

private fun isReddit(url: Uri) =
    url.scheme == "https" && url.host.let { it == "reddit.com" || it?.endsWith(".reddit.com") == true }

/** The reader's list of Lemmy instances in its storage (`lemmy-instances`). */
private const val INSTANCES_KEY = "openrelay:lemmy-instances"
/** Listed until the list is changed, as DEFAULT_INSTANCES in src/extension/sources.ts. */
private val DEFAULT_INSTANCES = setOf("lemmy.world")
private val INSTANCE_HOST = Regex("^(?!-)[a-z0-9-]{1,63}(?:\\.(?!-)[a-z0-9-]{1,63})+$")

/**
 * The Lemmy instances added in the reader, from its saved settings. The app
 * treats them as it treats Reddit; adding one in the app is the consent.
 */
internal fun listedInstances(saved: JSONObject): Set<String> {
    if (!saved.has(INSTANCES_KEY)) return DEFAULT_INSTANCES
    val list = saved.optJSONArray(INSTANCES_KEY) ?: return emptySet()
    return (0 until list.length())
        .mapNotNull { list.optString(it).takeIf { host -> INSTANCE_HOST.matches(host) } }
        .filter { !it.substringAfterLast('.').all(Char::isDigit) && !isReddit(Uri.parse("https://$it")) }
        .toSet()
}

/**
 * Reddit in one WebView, with OpenRelay's content script, and the reader in a
 * second WebView over it. Reddit's CSP blocks the reader's origin as an iframe,
 * so the two talk through this activity: `openRelayPage` (Reddit's top frame
 * only) and `openRelayNative` (the reader's origin only). Only the reader's
 * channel reaches storage.
 */
class MainActivity : ComponentActivity() {
    private lateinit var redditView: WebView
    private lateinit var readerView: WebView
    private lateinit var toggleButton: Button
    private lateinit var storage: JsonFileStorage
    private lateinit var offline: OfflineFiles
    private var pageProxy: JavaScriptReplyProxy? = null
    private var readerProxy: JavaScriptReplyProxy? = null
    private var readerShown = false
    /** The reader is showing saved posts because Reddit didn't load. */
    private var offlineShown = false
    private var redditFailed = false
    private var readerInset = 0
    private var pendingBack: Runnable? = null
    /** The content script and page channel, registered for [pageOrigins]. */
    private var pageScript: ScriptHandler? = null
    private var pageOrigins: Set<String> = REDDIT_ORIGINS
    private val network = Executors.newFixedThreadPool(4)
    private lateinit var downloads: Downloads
    private val saves = Executors.newSingleThreadExecutor()
    /** The file input waiting on the system picker; it's answered exactly once. */
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val pickFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }
    /** Answers the reader's `notifications.enable` once Android's prompt is answered. */
    private var notificationsAnswer: ((Boolean) -> Unit)? = null
    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {
        notificationsAnswer?.invoke(it)
        notificationsAnswer = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        storage = JsonFileStorage(File(filesDir, "openrelay-storage.json"))
        offline = OfflineFiles(File(filesDir, "offline"))
        downloads = Downloads(this) { message ->
            runOnUiThread { Toast.makeText(this, message, Toast.LENGTH_SHORT).show() }
        }
        val debuggable = applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        WebView.setWebContentsDebuggingEnabled(debuggable)
        CookieManager.getInstance().setAcceptCookie(true)

        redditView = newWebView(debuggable)
        readerView = newWebView(debuggable).apply { visibility = View.GONE }
        // The reader never sends Reddit's cookies (they'd be third-party here).
        CookieManager.getInstance().setAcceptThirdPartyCookies(readerView, false)
        toggleButton = Button(this).apply {
            isAllCaps = false
            setTextColor(Color.parseColor("#17283b"))
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                setStroke(dp(1), Color.parseColor("#8494a8"))
                cornerRadius = dp(20).toFloat()
            }
            minHeight = 0
            minimumHeight = 0
            setPadding(dp(13), dp(8), dp(13), dp(8))
            elevation = dp(2).toFloat()
            setOnClickListener {
                if (offlineShown) {
                    closeReader()
                    redditView.reload()
                } else {
                    sendToPage(JSONObject().put("kind", if (readerShown) "exit" else "toggle"))
                }
            }
        }
        val root = FrameLayout(this).apply {
            addView(redditView)
            addView(readerView)
            addView(toggleButton, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM or Gravity.START,
            ))
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime(),
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)
        updateToggle()

        setUpReader()
        setUpReddit()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // The reader closes its own screens first; it answers with "back".
                val reader = readerProxy
                if (!readerShown || reader == null) return hostBack()
                if (pendingBack != null) return
                val fallback = Runnable {
                    pendingBack = null
                    hostBack()
                }
                pendingBack = fallback
                readerView.postDelayed(fallback, BACK_TIMEOUT_MS)
                reader.postMessage(JSONObject().put("kind", "back").toString())
            }
        })
        redditView.loadUrl(intent.dataString?.takeIf { isSite(Uri.parse(it)) } ?: "https://www.reddit.com/")
        InboxNotifications.schedule(this)
    }

    /** A notification opened while the app is running: its page replaces the current one. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val url = intent.data ?: return
        if (isSite(url)) redditView.loadUrl(url.toString())
    }

    private fun newWebView(debuggable: Boolean) = WebView(this).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.setSupportMultipleWindows(true)
        webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                if (debuggable) Log.d(TAG, "console: ${message.message()}")
                return debuggable
            }

            override fun onCreateWindow(
                view: WebView,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: Message,
            ): Boolean = isUserGesture && catchNewWindow(resultMsg)

            // A file input (the reply composer's "Add image or GIF") opens the system picker.
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    pickFile.launch(params.createIntent())
                    true
                } catch (error: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }
        }
    }

    // --- The reader ---------------------------------------------------------

    private fun setUpReader() {
        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(READER_HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        readerView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? {
                // Everything on the reader's host is answered here, never by the network.
                if (request.url.host != READER_HOST) return null
                return assetLoader.shouldInterceptRequest(request.url) ?: notFound()
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // This WebView only ever shows the reader; links leave it.
                if (request.url.host == READER_HOST) return false
                openUrl(request.url)
                return true
            }
        }
        WebViewCompat.addWebMessageListener(
            readerView,
            "openRelayNative",
            setOf(READER_ORIGIN),
        ) { _: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, reply: JavaScriptReplyProxy ->
            if (sourceOrigin.toString() != READER_ORIGIN || !isMainFrame) return@addWebMessageListener
            val data = message.data ?: return@addWebMessageListener
            readerProxy = reply
            // Page-bound messages pass through as they are; they can be large.
            if (data.startsWith(POST_PREFIX)) {
                pageProxy?.postMessage(data)
                return@addWebMessageListener
            }
            val request = runCatching { JSONObject(data) }.getOrNull() ?: return@addWebMessageListener
            if (request.optString("kind") == "back") {
                val fallback = pendingBack ?: return@addWebMessageListener
                pendingBack = null
                readerView.removeCallbacks(fallback)
                if (!request.optBoolean("handled")) hostBack()
                return@addWebMessageListener
            }
            if (request.optString("kind") != "rpc") return@addWebMessageListener
            val response = JSONObject().put("kind", "rpc").put("id", request.opt("id"))
            if (request.optString("method") == "media.fetch") {
                // Off the main thread; the answer goes back on it.
                val url = request.optString("args")
                network.execute {
                    try {
                        response.put("value", fetchMedia(url))
                    } catch (error: Exception) {
                        response.put("error", error.message ?: "Request failed")
                    }
                    runOnUiThread { reply.postMessage(response.toString()) }
                }
                return@addWebMessageListener
            }
            if (request.optString("method").startsWith("downloads.")) {
                // One at a time, so a video's pieces are written in order.
                val method = request.optString("method")
                val args = request.optJSONObject("args") ?: JSONObject()
                saves.execute {
                    try {
                        response.put("value", downloads.handle(method, args))
                    } catch (error: Exception) {
                        response.put("error", error.message ?: "Download failed")
                    }
                    runOnUiThread { reply.postMessage(response.toString()) }
                }
                return@addWebMessageListener
            }
            if (request.optString("method") == "notifications.enable") {
                val answer = { granted: Boolean ->
                    if (granted) InboxNotifications.enable(this)
                    response.put("value", if (granted) "granted" else "declined")
                    reply.postMessage(response.toString())
                }
                when {
                    InboxNotifications.permitted(this) -> answer(true)
                    Build.VERSION.SDK_INT >= 33 && notificationsAnswer == null -> {
                        notificationsAnswer = { granted -> answer(granted && InboxNotifications.permitted(this)) }
                        askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                    // Turned off in Android's settings, or a prompt is already open.
                    else -> answer(false)
                }
                return@addWebMessageListener
            }
            try {
                response.put("value", handleStorage(request.getString("method"), request.opt("args")))
            } catch (error: Exception) {
                response.put("error", error.message ?: "Request failed")
            }
            reply.postMessage(response.toString())
        }
        WebViewCompat.addDocumentStartJavaScript(readerView, asset("reader-host.js"), setOf(READER_ORIGIN))
    }

    private fun handleStorage(method: String, args: Any?): Any = when (method) {
        "storage.getAll" -> storage.getAll()
        "storage.set" -> storage.set(args as JSONObject).also { instancesChanged() }.let { JSONObject.NULL }
        "storage.remove" -> storage.remove(args as JSONArray).also { instancesChanged() }.let { JSONObject.NULL }
        "offline.get" -> offline.get((args as JSONObject).getString("key"))
        "offline.set" -> (args as JSONObject).let { offline.set(it.getString("key"), it.get("value")) }
            .let { JSONObject.NULL }
        "offline.remove" -> offline.remove(args as JSONArray).let { JSONObject.NULL }
        "notifications.enabled" -> InboxNotifications.enabled(this)
        "notifications.disable" -> InboxNotifications.disable(this).let { JSONObject.NULL }
        else -> throw IllegalArgumentException("Unsupported method")
    }

    /** An image from [MEDIA_HOSTS] for an offline post: `{type, data}` with the bytes as base64. */
    private fun fetchMedia(value: String): JSONObject {
        val uri = Uri.parse(value)
        require(uri.scheme == "https" && uri.host in MEDIA_HOSTS) { "Not a Reddit image" }
        val connection = URL(value).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            val status = connection.responseCode
            if (status != 200) throw IllegalStateException("HTTP $status")
            if (connection.contentLengthLong > MEDIA_MAX_BYTES) throw IllegalStateException("Too large")
            val bytes = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    bytes.write(buffer, 0, read)
                    if (bytes.size() > MEDIA_MAX_BYTES) throw IllegalStateException("Too large")
                }
            }
            return JSONObject()
                .put("type", connection.contentType?.substringBefore(';')?.trim() ?: "")
                .put("data", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
        } finally {
            connection.disconnect()
        }
    }

    private fun showReader(shown: Boolean) {
        readerShown = shown
        readerView.visibility = if (shown) View.VISIBLE else View.GONE
        if (shown) readerView.requestFocus()
        updateToggle()
    }

    /** Back once the reader has nothing left to close: Reddit's history, then leave. */
    private fun hostBack() {
        if (redditView.canGoBack()) redditView.goBack() else finish()
    }

    private fun closeReader() {
        offlineShown = false
        showReader(false)
        readerProxy = null
        abortSaves()
        readerView.loadUrl("about:blank")
    }

    /** Reddit didn't load: show the posts saved for offline reading. */
    private fun openOffline() {
        readerProxy = null
        abortSaves()
        readerView.loadUrl(OFFLINE_URL)
        offlineShown = true
        showReader(true)
    }

    /** The reader document is going away: drop the videos it was still sending. */
    private fun abortSaves() {
        saves.execute { downloads.abortAll() }
    }

    private fun updateToggle() {
        toggleButton.text = when {
            offlineShown -> "Try Reddit"
            readerShown -> "Original Reddit"
            else -> "OpenRelay"
        }
        (toggleButton.layoutParams as? FrameLayout.LayoutParams)?.let {
            it.leftMargin = dp(12)
            it.bottomMargin = dp(12 + if (readerShown) readerInset else 0)
            toggleButton.layoutParams = it
        }
    }

    // --- Reddit -------------------------------------------------------------

    private fun setUpReddit() {
        redditView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (isSite(request.url)) return false
                openUrl(request.url)
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                // A new document: its content script mounts the reader again if it should.
                // (pageProxy stays: the new document's first message can arrive before this.)
                redditFailed = false
                closeReader()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) redditFailed = true
            }

            override fun onPageFinished(view: WebView, url: String?) {
                // After the error page, so it can't close the reader again.
                if (redditFailed) openOffline()
            }
        }
        registerPage()
    }

    // --- Lemmy instances ------------------------------------------------------

    private fun instanceHosts(): Set<String> = listedInstances(storage.getAll())

    /** A site OpenRelay reads: Reddit, or an added Lemmy instance. */
    private fun isSite(url: Uri) =
        isReddit(url) || (url.scheme == "https" && url.port == -1 && url.host in instanceHosts())

    /** Registers the content script and page channel again when the instances change. */
    private fun instancesChanged() {
        val origins = REDDIT_ORIGINS + instanceHosts().map { "https://$it" }
        if (origins != pageOrigins) {
            pageOrigins = origins
            registerPage()
        }
    }

    /** The content script and the page's channel, on Reddit and the added instances. */
    private fun registerPage() {
        pageScript?.remove()
        WebViewCompat.removeWebMessageListener(redditView, "openRelayPage")
        pageOrigins = REDDIT_ORIGINS + instanceHosts().map { "https://$it" }
        WebViewCompat.addWebMessageListener(
            redditView,
            "openRelayPage",
            pageOrigins,
        ) { _: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, reply: JavaScriptReplyProxy ->
            if (sourceOrigin.toString() !in pageOrigins || !isMainFrame) return@addWebMessageListener
            val data = message.data ?: return@addWebMessageListener
            pageProxy = reply
            if (data.startsWith(POST_PREFIX)) {
                readerProxy?.postMessage(data)
                return@addWebMessageListener
            }
            val command = runCatching { JSONObject(data) }.getOrNull() ?: return@addWebMessageListener
            when (command.optString("kind")) {
                "open" -> {
                    readerProxy = null
                    abortSaves()
                    readerView.loadUrl(READER_URL + "#" + command.optString("hash"))
                }
                "visible" -> showReader(command.optBoolean("visible"))
                "close" -> closeReader()
                "inset" -> {
                    readerInset = command.optInt("bottom").coerceIn(0, 200)
                    updateToggle()
                }
            }
        }

        val content = asset("page-host.js")
            .replace("/*READER_URL*/", JSONObject.quote(READER_URL))
            .replace("/*CONTENT_JS*/", asset("openrelay/content.js"))
        // TODO: run in an isolated world (WebViewCompat.addJavaScriptOnEvent with
        // getExecutionWorld) where JS_INJECTION_IN_FRAME_AND_WORLD is supported.
        pageScript = WebViewCompat.addDocumentStartJavaScript(redditView, content, pageOrigins)
    }

    private fun sendToPage(message: JSONObject) {
        pageProxy?.postMessage(message.toString())
    }

    // --- New windows and links ----------------------------------------------

    /** Reddit and instance links open in the app's page view (same session); others in the browser. */
    private fun openUrl(url: Uri) {
        if (isSite(url)) {
            redditView.loadUrl(url.toString())
        } else if (url.scheme == "https" || url.scheme == "http") {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE))
            } catch (_: ActivityNotFoundException) {
                Log.w(TAG, "No app to open a link")
            }
        }
    }

    /** `window.open` gets a throwaway WebView whose first navigation is routed by [openUrl]. */
    private fun catchNewWindow(resultMsg: Message): Boolean {
        val catcher = WebView(this)
        catcher.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                openUrl(request.url)
                view.post { view.destroy() }
                return true
            }
        }
        (resultMsg.obj as WebView.WebViewTransport).webView = catcher
        resultMsg.sendToTarget()
        return true
    }

    private fun asset(path: String): String =
        assets.open(path).bufferedReader().use { it.readText() }

    private fun notFound() = WebResourceResponse(
        "text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)),
    )

    private fun dp(value: Int) = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics,
    ).toInt()

    override fun onDestroy() {
        network.shutdownNow()
        abortSaves()
        saves.shutdown()
        redditView.destroy()
        readerView.destroy()
        super.onDestroy()
    }

    private companion object {
        /** Both shims send `{"kind":"post","message":…}` for the other side, unchanged. */
        const val POST_PREFIX = "{\"kind\":\"post\","

        /** How long a back press waits for the reader before going back itself. */
        const val BACK_TIMEOUT_MS = 500L
    }
}

/**
 * Posts saved for offline reading: one JSON file per key in app-private
 * storage. Keys get the same check as OFFLINE_KEY in src/hosts/types.ts.
 */
class OfflineFiles(private val dir: File) {
    private val keyPattern = Regex("^[a-z]+(?::[A-Za-z0-9_]{1,40})?$")

    private fun file(key: String): File {
        require(keyPattern.matches(key)) { "Invalid key" }
        return File(dir, key.replace(":", "-") + ".json")
    }

    @Synchronized
    fun get(key: String): Any {
        val file = file(key)
        if (!file.exists()) return JSONObject.NULL
        return JSONObject(file.readText()).get("value")
    }

    @Synchronized
    fun set(key: String, value: Any) {
        val file = file(key)
        dir.mkdirs()
        val temp = File(file.path + ".tmp")
        // Wrapped, so any JSON value (a string too) reads back as it was.
        temp.writeText(JSONObject().put("value", value).toString())
        temp.renameTo(file)
    }

    @Synchronized
    fun remove(keys: JSONArray) {
        for (i in 0 until keys.length()) file(keys.getString(i)).delete()
    }
}

/**
 * The media viewer's downloads, into the shared Downloads folder: a remote file
 * through DownloadManager (without cookies), and a file the reader built (a
 * v.redd.it video joined with its sound) through MediaStore, sent in pieces.
 * Neither needs a storage permission from API 29. Called on one thread only.
 */
class Downloads(context: Context, private val notify: (String) -> Unit) {
    private val context = context.applicationContext
    private class Pending(val uri: Uri, val output: OutputStream) {
        var size = 0L
    }
    private val pending = HashMap<Int, Pending>()
    private var nextId = 0

    fun handle(method: String, args: JSONObject): Any = when (method) {
        "downloads.url" -> enqueue(args.optString("url"), args.optString("filename"))
        "downloads.begin" -> begin(args.optString("filename"), args.optString("type"))
        "downloads.chunk" -> chunk(args.getInt("id"), args.getString("data"))
        "downloads.end" -> end(args.getInt("id"))
        "downloads.abort" -> abort(args.getInt("id"))
        else -> throw IllegalArgumentException("Unsupported method")
    }

    private fun enqueue(value: String, filename: String): Any {
        val uri = Uri.parse(value)
        require(uri.scheme == "https" && !uri.host.isNullOrEmpty()) { "Not an https URL" }
        val name = filename.takeIf { FILE_NAME.matches(it) }
            ?: URLUtil.guessFileName(value, null, null).replace(Regex("[^\\w.-]"), "_")
        val request = DownloadManager.Request(uri)
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
        context.getSystemService(DownloadManager::class.java).enqueue(request)
        notify("Downloading $name")
        return JSONObject.NULL
    }

    private fun begin(filename: String, type: String): Int {
        require(FILE_NAME.matches(filename)) { "Invalid file name" }
        require(MIME_TYPE.matches(type)) { "Invalid type" }
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, filename)
            put(MediaStore.Downloads.MIME_TYPE, type)
            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("Can't save to Downloads")
        val output = try {
            resolver.openOutputStream(uri) ?: throw IllegalStateException("Can't save to Downloads")
        } catch (error: Exception) {
            resolver.delete(uri, null, null)
            throw error
        }
        val id = ++nextId
        pending[id] = Pending(uri, output)
        return id
    }

    private fun chunk(id: Int, data: String): Any {
        val file = pending[id] ?: throw IllegalArgumentException("No such download")
        try {
            val bytes = Base64.decode(data, Base64.DEFAULT)
            file.size += bytes.size
            if (file.size > SAVE_MAX_BYTES) throw IllegalStateException("Too large")
            file.output.write(bytes)
        } catch (error: Exception) {
            abort(id)
            throw error
        }
        return JSONObject.NULL
    }

    private fun end(id: Int): Any {
        val file = pending.remove(id) ?: throw IllegalArgumentException("No such download")
        try {
            file.output.close()
            val done = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
            context.contentResolver.update(file.uri, done, null, null)
        } catch (error: Exception) {
            context.contentResolver.delete(file.uri, null, null)
            throw error
        }
        notify("Saved to Downloads")
        return JSONObject.NULL
    }

    private fun abort(id: Int): Any {
        val file = pending.remove(id) ?: return JSONObject.NULL
        runCatching { file.output.close() }
        runCatching { context.contentResolver.delete(file.uri, null, null) }
        return JSONObject.NULL
    }

    /** Drops every unfinished file, when the reader that was sending them is gone. */
    fun abortAll() {
        for (id in pending.keys.toList()) abort(id)
    }

    private companion object {
        val FILE_NAME = Regex("^[\\w-][\\w.-]{0,119}\\.\\w{1,10}$")
        val MIME_TYPE = Regex("^(?:image|video|audio)/[\\w.+-]{1,60}$")
        const val SAVE_MAX_BYTES = 1L shl 30
    }
}

/** The reader's storage: one JSON object in app-private storage. */
class JsonFileStorage(private val file: File) {
    private val data: JSONObject =
        runCatching { JSONObject(file.readText()) }.getOrDefault(JSONObject())

    @Synchronized
    fun getAll(): JSONObject = JSONObject(data.toString())

    @Synchronized
    fun set(items: JSONObject) {
        for (key in items.keys()) data.put(key, items.get(key))
        save()
    }

    @Synchronized
    fun remove(keys: JSONArray) {
        for (i in 0 until keys.length()) data.remove(keys.getString(i))
        save()
    }

    private fun save() {
        val temp = File(file.path + ".tmp")
        temp.writeText(data.toString())
        temp.renameTo(file)
    }
}
