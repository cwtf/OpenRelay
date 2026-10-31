package io.github.cwtf.openrelay

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.util.Base64
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
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
    private val network = Executors.newFixedThreadPool(4)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        storage = JsonFileStorage(File(filesDir, "openrelay-storage.json"))
        offline = OfflineFiles(File(filesDir, "offline"))
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
        redditView.loadUrl(intent.dataString?.takeIf { isReddit(Uri.parse(it)) } ?: "https://www.reddit.com/")
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
        "storage.set" -> storage.set(args as JSONObject).let { JSONObject.NULL }
        "storage.remove" -> storage.remove(args as JSONArray).let { JSONObject.NULL }
        "offline.get" -> offline.get((args as JSONObject).getString("key"))
        "offline.set" -> (args as JSONObject).let { offline.set(it.getString("key"), it.get("value")) }
            .let { JSONObject.NULL }
        "offline.remove" -> offline.remove(args as JSONArray).let { JSONObject.NULL }
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
        readerView.loadUrl("about:blank")
    }

    /** Reddit didn't load: show the posts saved for offline reading. */
    private fun openOffline() {
        readerProxy = null
        readerView.loadUrl(OFFLINE_URL)
        offlineShown = true
        showReader(true)
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
                if (isReddit(request.url)) return false
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
        WebViewCompat.addWebMessageListener(
            redditView,
            "openRelayPage",
            REDDIT_ORIGINS,
        ) { _: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, reply: JavaScriptReplyProxy ->
            if (sourceOrigin.toString() !in REDDIT_ORIGINS || !isMainFrame) return@addWebMessageListener
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
        WebViewCompat.addDocumentStartJavaScript(redditView, content, REDDIT_ORIGINS)
    }

    private fun sendToPage(message: JSONObject) {
        pageProxy?.postMessage(message.toString())
    }

    // --- New windows and links ----------------------------------------------

    /** Reddit links open in the app's Reddit view (same session); others in the browser. */
    private fun openUrl(url: Uri) {
        if (isReddit(url)) {
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
