package io.github.cwtf.openrelay

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebSettings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.time.Instant
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

private const val TAG = "OpenRelay"
private const val CHANNEL = "inbox"
private const val WORK_NAME = "inbox-check"
private const val PREFS = "inbox-notifications"
private const val TAG_PREFIX = "openrelay:"
/** Notices remembered as already shown (or there before notifications were on). */
private const val SEEN_MAX = 1000
/** At most this many notifications from one check; the rest are only remembered. */
private const val NOTIFY_MAX = 10
private const val BODY_MAX = 300

/** One unread inbox item, as a notification. [key] is unique across sites. */
data class Notice(
    val key: String,
    val title: String,
    val text: String,
    val site: String,
    val url: String,
    val time: Long,
)

/**
 * Inbox notifications: a WorkManager job about every 15 minutes (Android may
 * run it less often) reads the unread inbox of Reddit and each added Lemmy
 * instance with the WebView's own cookies, as the content script would, and
 * nothing is marked read. Nothing is sent anywhere else and there's no push
 * server: Reddit's push is for its own app only and Lemmy has none.
 */
object InboxNotifications {
    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun permitted(context: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED) &&
            NotificationManagerCompat.from(context).areNotificationsEnabled()

    /** On, and Android still lets the app notify. */
    fun enabled(context: Context): Boolean =
        prefs(context).getBoolean("enabled", false) && permitted(context)

    /** Turns them on; call after the permission was granted. */
    fun enable(context: Context) {
        prefs(context).edit().putBoolean("enabled", true).apply()
        schedule(context)
    }

    /** Turns them off and forgets what was seen, so turning them on starts afresh. */
    fun disable(context: Context) {
        prefs(context).edit().clear().apply()
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
        val manager = context.getSystemService(NotificationManager::class.java)
        for (shown in manager.activeNotifications)
            if (shown.tag?.startsWith(TAG_PREFIX) == true) manager.cancel(shown.tag, shown.id)
    }

    /** Keeps the job scheduled while they're on (it survives restarts and updates). */
    fun schedule(context: Context) {
        if (!prefs(context).getBoolean("enabled", false)) return
        val request = PeriodicWorkRequestBuilder<InboxCheckWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** Checks every signed-in site once. */
    @SuppressLint("MissingPermission") // permitted() is checked first.
    internal fun check(context: Context) {
        val prefs = prefs(context)
        if (!prefs.getBoolean("enabled", false) || !permitted(context)) return
        val seen = LinkedHashSet<String>().apply {
            val saved = JSONArray(prefs.getString("seen", "[]"))
            for (i in 0 until saved.length()) add(saved.getString(i))
        }
        val seeded = prefs.getStringSet("seeded", emptySet())!!.toMutableSet()
        val userAgent = onMain { WebSettings.getDefaultUserAgent(context) }
        val fresh = ArrayList<Notice>()

        val sites = linkedMapOf<String, () -> List<Notice>?>("reddit" to { checkReddit(userAgent) })
        for (host in listedInstances(savedSettings(context)))
            sites["lemmy:$host"] = { checkLemmy(host, userAgent) }
        for ((site, read) in sites) {
            // null: signed out, or the site refused; leave its notifications as they are.
            val notices = try {
                read()
            } catch (error: Exception) {
                Log.w(TAG, "Inbox check failed for $site: ${error.message}")
                null
            } ?: continue
            val unread = notices.map { it.key }.toSet()
            cancelRead(context, site, unread)
            // The first check of a site only notes what's already there.
            if (site in seeded) fresh += notices.filter { it.key !in seen }
            seen += unread
            seeded += site
        }

        val manager = NotificationManagerCompat.from(context)
        if (fresh.isNotEmpty()) createChannel(context)
        for (notice in fresh.sortedByDescending { it.time }.take(NOTIFY_MAX)) {
            try {
                manager.notify(TAG_PREFIX + notice.key, 1, build(context, notice))
            } catch (error: SecurityException) {
                break // The permission was taken back.
            }
        }
        val kept = seen.toList().takeLast(SEEN_MAX)
        prefs.edit()
            .putString("seen", JSONArray(kept).toString())
            .putStringSet("seeded", seeded)
            .apply()
    }

    /** Drops a site's notifications for items that are read now. */
    private fun cancelRead(context: Context, site: String, unread: Set<String>) {
        val manager = context.getSystemService(NotificationManager::class.java)
        for (shown in manager.activeNotifications) {
            val tag = shown.tag ?: continue
            if (!tag.startsWith(TAG_PREFIX)) continue
            val key = tag.removePrefix(TAG_PREFIX)
            if (key.startsWith("$site:") && key !in unread) manager.cancel(tag, shown.id)
        }
    }

    private fun createChannel(context: Context) {
        val channel = NotificationChannel(CHANNEL, "Inbox", NotificationManager.IMPORTANCE_DEFAULT)
            .apply { description = "Replies, mentions and messages" }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun build(context: Context, notice: Notice) =
        NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(notice.title)
            .setContentText(notice.text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(notice.text))
            .setSubText(notice.site)
            .setWhen(notice.time)
            .setShowWhen(true)
            .setAutoCancel(true)
            .setGroup(CHANNEL)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            // The lock screen shows that something arrived, not what.
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setContentIntent(
                PendingIntent.getActivity(
                    context,
                    notice.key.hashCode(),
                    Intent(Intent.ACTION_VIEW, Uri.parse(notice.url), context, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )
            .build()

    // --- Reddit ---------------------------------------------------------------

    /** The unread inbox, read with `mark=false`, as in the reader. Null when signed out. */
    private fun checkReddit(userAgent: String): List<Notice>? {
        val origin = "https://www.reddit.com"
        val cookie = onMain { CookieManager.getInstance().getCookie(origin) } ?: return null
        if (!Regex("(?:^|;\\s*)reddit_session=").containsMatchIn(cookie)) return null
        val data = getJson(origin, "/message/unread.json?mark=false&limit=25&raw_json=1", userAgent, cookie = cookie)
            ?: return null
        return redditNotices(data)
    }

    // --- Lemmy ----------------------------------------------------------------

    /** Replies, mentions and received messages, read with `unread_only`. Null when signed out. */
    private fun checkLemmy(host: String, userAgent: String): List<Notice>? {
        val origin = "https://$host"
        val cookie = onMain { CookieManager.getInstance().getCookie(origin) } ?: return null
        val token = Regex("(?:^|;\\s*)jwt=([\\w.-]+)").find(cookie)?.groupValues?.get(1) ?: return null
        val get = { path: String -> getJson(origin, path, userAgent, token = token) }
        val counts = get("/api/v3/user/unread_count") ?: return null
        val unread = "?unread_only=true&sort=New&page=1&limit=20"
        val replies = if (counts.optInt("replies") > 0) get("/api/v3/user/replies$unread") ?: return null else null
        val mentions = if (counts.optInt("mentions") > 0) get("/api/v3/user/mention$unread") ?: return null else null
        var messages: JSONObject? = null
        var me = -1L
        if (counts.optInt("private_messages") > 0) {
            messages = get("/api/v3/private_message/list?unread_only=true&page=1&limit=20") ?: return null
            // The list has the messages you sent too; they're unread until answered.
            me = get("/api/v3/site")?.optJSONObject("my_user")?.optJSONObject("local_user_view")
                ?.optJSONObject("person")?.optLong("id", -1) ?: -1
        }
        return lemmyNotices(host, replies, mentions, messages, me)
    }

    // --- Requests -------------------------------------------------------------

    /**
     * A GET with the WebView's user agent and either the site's cookies or a
     * Lemmy token. Null unless it answers 200 with JSON: a sign-in page, a bot
     * check or a refusal all end the check for that site.
     */
    private fun getJson(
        origin: String,
        path: String,
        userAgent: String,
        cookie: String? = null,
        token: String? = null,
    ): JSONObject? {
        val connection = URL(origin + path).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.setRequestProperty("User-Agent", userAgent)
            connection.setRequestProperty("Accept", "application/json")
            if (cookie != null) connection.setRequestProperty("Cookie", cookie)
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            val status = connection.responseCode
            // Keep the session as fresh as the browser would.
            if (cookie != null) saveCookies(origin, connection)
            if (status != 200 || connection.contentType?.contains("json") != true) {
                Log.w(TAG, "Inbox check: HTTP $status from $origin")
                return null
            }
            return JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally {
            connection.disconnect()
        }
    }

    private fun saveCookies(origin: String, connection: HttpURLConnection) {
        val cookies = connection.headerFields.entries
            .filter { it.key.equals("Set-Cookie", ignoreCase = true) }
            .flatMap { it.value }
        if (cookies.isEmpty()) return
        onMain {
            val manager = CookieManager.getInstance()
            for (value in cookies) manager.setCookie(origin, value)
            manager.flush()
        }
    }

    /** The WebView's cookie store and settings are used from the main thread, as the app does. */
    private fun <T> onMain(block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        var result: Result<T>? = null
        val done = CountDownLatch(1)
        Handler(Looper.getMainLooper()).post {
            result = runCatching(block)
            done.countDown()
        }
        if (!done.await(10, TimeUnit.SECONDS)) throw IllegalStateException("Main thread busy")
        return result!!.getOrThrow()
    }

    private fun savedSettings(context: Context): JSONObject =
        runCatching { JSONObject(File(context.filesDir, "openrelay-storage.json").readText()) }
            .getOrDefault(JSONObject())
}

class InboxCheckWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        // Failures wait for the next period instead of retrying sooner.
        try {
            InboxNotifications.check(applicationContext)
        } catch (error: Exception) {
            Log.w(TAG, "Inbox check failed: ${error.message}")
        }
        return Result.success()
    }
}

// --- Parsing (pure, for the unit tests) ---------------------------------------

private fun snippet(text: String): String {
    val flat = text.replace(Regex("\\s+"), " ").trim()
    return if (flat.length > BODY_MAX) flat.take(BODY_MAX - 1) + "…" else flat
}

/** `/message/unread.json`: comment replies, mentions and messages still marked new. */
fun redditNotices(data: JSONObject): List<Notice> {
    val children = data.optJSONObject("data")?.optJSONArray("children") ?: return emptyList()
    return (0 until children.length()).mapNotNull { i ->
        val child = children.optJSONObject(i) ?: return@mapNotNull null
        val d = child.optJSONObject("data") ?: return@mapNotNull null
        val name = d.optString("name")
        if (!Regex("^t[14]_[a-z0-9]+$").matches(name) || !d.optBoolean("new", true)) return@mapNotNull null
        val author = d.optString("author").takeIf { it.isNotEmpty() && it != "null" }?.let { "u/$it" }
            ?: d.optString("subreddit_name_prefixed").takeIf { it.isNotEmpty() && it != "null" }
            ?: "Reddit"
        val sub = d.optString("subreddit").takeIf { it.isNotEmpty() && it != "null" }
        val context = d.optString("context")
        val comment = name.startsWith("t1_")
        val title = if (comment) when (d.optString("subject")) {
            "post reply" -> "$author replied to your post"
            "username mention" -> "$author mentioned you"
            else -> "$author replied to your comment"
        } else "$author: ${d.optString("subject")}"
        Notice(
            key = "reddit:$name",
            title = title,
            text = snippet(d.optString("body")),
            site = sub?.let { "r/$it" } ?: "Reddit",
            url = "https://www.reddit.com" + when {
                // Only a path on Reddit itself; the reader opens the post.
                comment && Regex("^/r/\\w+/comments/[a-z0-9]+/").containsMatchIn(context) -> context
                comment -> "/message/inbox"
                else -> "/message/messages/${name.removePrefix("t4_")}"
            },
            time = (d.optDouble("created_utc", 0.0) * 1000).toLong(),
        )
    }
}

/**
 * Lemmy's unread replies (`/api/v3/user/replies`), mentions
 * (`/api/v3/user/mention`) and private messages to [me]
 * (`/api/v3/private_message/list`).
 */
fun lemmyNotices(
    host: String,
    replies: JSONObject?,
    mentions: JSONObject?,
    messages: JSONObject?,
    me: Long,
): List<Notice> {
    val site = "lemmy:$host"
    fun list(data: JSONObject?, key: String) =
        data?.optJSONArray(key)?.let { array -> (0 until array.length()).mapNotNull { array.optJSONObject(it) } }
            ?: emptyList()
    fun person(view: JSONObject): String {
        val creator = view.optJSONObject("creator") ?: return "Someone"
        val name = "@" + creator.optString("name")
        if (creator.optBoolean("local", true)) return name
        return runCatching { URI(creator.optString("actor_id")).host }.getOrNull()?.let { "$name@$it" } ?: name
    }
    fun time(value: String) = runCatching {
        Instant.parse(if (value.endsWith("Z") || value.contains('+')) value else value + "Z").toEpochMilli()
    }.getOrDefault(0L)
    fun comment(view: JSONObject, kind: String, id: Long, verb: String): Notice? {
        val c = view.optJSONObject("comment") ?: return null
        if (c.optBoolean("deleted") || c.optBoolean("removed")) return null
        val post = view.optJSONObject("post")?.optString("name").orEmpty()
        return Notice(
            key = "$site:$kind:$id",
            title = "${person(view)} $verb",
            text = snippet(c.optString("content")),
            site = view.optJSONObject("community")?.optString("name")?.takeIf { it.isNotEmpty() }
                ?.let { "c/$it" } ?: host,
            url = "https://$host/comment/${c.optLong("id")}",
            time = time(c.optString("published")),
        ).let { if (post.isEmpty()) it else it.copy(title = "${it.title} in “${snippet(post).take(60)}”") }
    }
    val notices = ArrayList<Notice>()
    for (view in list(replies, "replies")) {
        val reply = view.optJSONObject("comment_reply") ?: continue
        if (reply.optBoolean("read")) continue
        val top = view.optJSONObject("comment")?.optString("path").orEmpty().split(".").size <= 2
        comment(view, "reply", reply.optLong("id"), if (top) "replied to your post" else "replied to your comment")
            ?.let(notices::add)
    }
    for (view in list(mentions, "mentions")) {
        val mention = view.optJSONObject("person_mention") ?: continue
        if (mention.optBoolean("read")) continue
        comment(view, "mention", mention.optLong("id"), "mentioned you")?.let(notices::add)
    }
    for (view in list(messages, "private_messages")) {
        val m = view.optJSONObject("private_message") ?: continue
        if (m.optBoolean("read") || m.optBoolean("deleted") || m.optLong("recipient_id") != me) continue
        notices += Notice(
            key = "$site:message:${m.optLong("id")}",
            title = "Message from ${person(view)}",
            text = snippet(m.optString("content")),
            site = host,
            url = "https://$host/inbox",
            time = time(m.optString("published")),
        )
    }
    return notices
}
