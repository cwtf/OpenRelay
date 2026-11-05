package io.github.cwtf.openrelay

/**
 * The cookie side of switching accounts (`ReaderHost.accounts`), kept free of
 * Android so it can be unit-tested. The activity reads a site's cookies with
 * `CookieManager.getCookie`, which gives only `name=value` pairs, saves that
 * string under the account's name, and later writes it back with the
 * `Set-Cookie` strings built here.
 *
 * What `getCookie` doesn't give is lost on restore: each cookie's expiry,
 * path, SameSite and HttpOnly flag. Restored cookies get [RESTORED_MAX_AGE]
 * and `Path=/`; the site replaces them with its own when it next sets them.
 */
internal object AccountCookies {
    /** As the reader's `/^[\w-]{1,64}$/`. */
    private val NAME = Regex("^[\\w-]{1,64}$")
    /** A cookie name: an RFC 6265 token. */
    private val COOKIE_NAME = Regex("^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,256}$")
    private val CONTROL = Regex("[\\x00-\\x1f\\x7f]")
    private val REDDIT_HOSTS = setOf("www.reddit.com", "old.reddit.com", "reddit.com")
    /** Reddit's cookies are on `.reddit.com`; these are the hosts that may hold host-only ones. */
    private val REDDIT_ORIGINS = listOf("https://www.reddit.com", "https://old.reddit.com")
    /** Reddit sets these HttpOnly, so the restored copies are too. */
    private val HTTP_ONLY = setOf("reddit_session")
    /** 180 days: long enough to outlive a restart; the server decides if it's still valid. */
    const val RESTORED_MAX_AGE = 180L * 24 * 60 * 60
    private const val EXPIRED = "Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"

    /** The cookie scope an account belongs to, or null when `site` isn't one OpenRelay reads. */
    class Site(
        /** The key the saved copies are kept under: one for all of Reddit's hosts. */
        val key: String,
        /** The origins whose cookies make up the session. */
        val origins: List<String>,
        /** The `Domain` attribute for restored cookies, or null for host-only ones. */
        private val domain: String?,
        private val host: String,
    ) {
        /** `(url, Set-Cookie)` pairs that delete each of `names` wherever it may be set. */
        fun expire(names: Collection<String>): List<Pair<String, String>> =
            names.filter { COOKIE_NAME.matches(it) }.distinct().flatMap { name ->
                val hostOnly = origins.map { it to "$name=; Path=/; $EXPIRED; Secure" }
                // A Lemmy instance's page could also have set it for its whole domain.
                val shared = if (name.startsWith("__Host-")) emptyList()
                else listOf(origins.first() to "$name=; Domain=${domain ?: host}; Path=/; $EXPIRED; Secure")
                hostOnly + shared
            }

        /** `(url, Set-Cookie)` pairs that set each saved cookie again. */
        fun restore(cookies: List<Pair<String, String>>): List<Pair<String, String>> =
            cookies.map { (name, value) ->
                val scope = if (domain == null || name.startsWith("__Host-")) "" else "Domain=$domain; "
                val httpOnly = if (name in HTTP_ONLY) "; HttpOnly" else ""
                origins.first() to "$name=$value; ${scope}Path=/; Max-Age=$RESTORED_MAX_AGE; Secure$httpOnly"
            }
    }

    /** The account name if it's valid, else an exception for the reader. */
    fun name(value: String): String {
        require(NAME.matches(value)) { "Invalid account name" }
        return value
    }

    /** Reddit's hosts, or one of the listed Lemmy instances; anything else is refused. */
    fun site(value: String, instances: Set<String>): Site = when (value) {
        in REDDIT_HOSTS -> Site("reddit.com", REDDIT_ORIGINS, ".reddit.com", "reddit.com")
        in instances -> Site(value, listOf("https://$value"), null, value)
        else -> throw IllegalArgumentException("Not a site OpenRelay reads")
    }

    /**
     * `name=value` pairs from a `Cookie` header as `getCookie` gives it. The
     * first of a repeated name wins (the most specific one), and anything that
     * couldn't be written back as it was is dropped.
     */
    fun parse(header: String?): List<Pair<String, String>> {
        if (header.isNullOrBlank()) return emptyList()
        val seen = HashSet<String>()
        return header.split(';').mapNotNull { part ->
            val pair = part.trim()
            val equals = pair.indexOf('=')
            if (equals <= 0) return@mapNotNull null
            val name = pair.substring(0, equals)
            val value = pair.substring(equals + 1)
            if (!COOKIE_NAME.matches(name) || CONTROL.containsMatchIn(value)) return@mapNotNull null
            if (!seen.add(name)) return@mapNotNull null
            name to value
        }
    }

    /** The cookies of several origins as one list, the first origin's first. */
    fun merge(headers: List<String?>): List<Pair<String, String>> {
        val seen = HashSet<String>()
        return headers.flatMap(::parse).filter { seen.add(it.first) }
    }

    /** The saved form: a `Cookie` header again. */
    fun format(cookies: List<Pair<String, String>>): String =
        cookies.joinToString("; ") { (name, value) -> "$name=$value" }
}
