package io.github.cwtf.openrelay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountCookiesTest {
    private val instances = setOf("lemmy.world")

    @Test
    fun parsesNameValuePairsAndKeepsTheFirstOfARepeatedName() {
        val cookies = AccountCookies.parse("reddit_session=abc.def; token_v2=ey=x==; loid=1; loid=2; edgebucket=")
        assertEquals(
            listOf("reddit_session" to "abc.def", "token_v2" to "ey=x==", "loid" to "1", "edgebucket" to ""),
            cookies,
        )
    }

    @Test
    fun dropsWhatCouldNotBeWrittenBack() {
        assertEquals(emptyList<Pair<String, String>>(), AccountCookies.parse(null))
        assertEquals(emptyList<Pair<String, String>>(), AccountCookies.parse("  "))
        assertEquals(
            listOf("ok" to "1"),
            AccountCookies.parse("novalue; =x; bad name=1; ok=1; ctl=a\u0001b; semi\"=2"),
        )
    }

    @Test
    fun mergesOriginsWithTheFirstOriginWinning() {
        val merged = AccountCookies.merge(listOf("a=1; b=2", null, "b=3; c=4"))
        assertEquals(listOf("a" to "1", "b" to "2", "c" to "4"), merged)
        assertEquals("a=1; b=2; c=4", AccountCookies.format(merged))
        assertEquals(merged, AccountCookies.parse(AccountCookies.format(merged)))
    }

    @Test
    fun acceptsOnlyRedditAndListedInstances() {
        for (host in listOf("www.reddit.com", "old.reddit.com", "reddit.com")) {
            assertEquals("reddit.com", AccountCookies.site(host, instances).key)
        }
        assertEquals("lemmy.world", AccountCookies.site("lemmy.world", instances).key)
        for (host in listOf("lemmy.ml", "evil.reddit.com.example", "new.reddit.com", "", "https://www.reddit.com")) {
            assertThrows(IllegalArgumentException::class.java) { AccountCookies.site(host, instances) }
        }
    }

    @Test
    fun checksAccountNames() {
        assertEquals("some_user-1", AccountCookies.name("some_user-1"))
        for (bad in listOf("", "a/b", "a b", "x".repeat(65), "a;b", "../x")) {
            assertThrows(IllegalArgumentException::class.java) { AccountCookies.name(bad) }
        }
    }

    @Test
    fun restoresRedditCookiesOnTheWholeDomain() {
        val site = AccountCookies.site("old.reddit.com", instances)
        val max = AccountCookies.RESTORED_MAX_AGE
        assertEquals(
            listOf(
                "https://www.reddit.com" to "reddit_session=abc; Domain=.reddit.com; Path=/; Max-Age=$max; Secure; HttpOnly",
                "https://www.reddit.com" to "token_v2=ey; Domain=.reddit.com; Path=/; Max-Age=$max; Secure",
                "https://www.reddit.com" to "__Host-x=1; Path=/; Max-Age=$max; Secure",
            ),
            site.restore(listOf("reddit_session" to "abc", "token_v2" to "ey", "__Host-x" to "1")),
        )
    }

    @Test
    fun restoresLemmyCookiesOnTheInstanceOnly() {
        val site = AccountCookies.site("lemmy.world", instances)
        assertEquals(
            listOf("https://lemmy.world" to "jwt=ey.j.w; Path=/; Max-Age=${AccountCookies.RESTORED_MAX_AGE}; Secure"),
            site.restore(listOf("jwt" to "ey.j.w")),
        )
    }

    @Test
    fun expiresRedditCookiesOnTheDomainAndEachHost() {
        val expire = AccountCookies.site("www.reddit.com", instances).expire(listOf("token_v2", "token_v2", "bad name"))
        assertEquals(3, expire.size)
        assertTrue(expire.all { it.second.startsWith("token_v2=; ") && "Max-Age=0" in it.second })
        assertEquals(
            listOf("https://www.reddit.com", "https://old.reddit.com", "https://www.reddit.com"),
            expire.map { it.first },
        )
        assertTrue("Domain" !in expire[0].second && "Domain" !in expire[1].second)
        assertTrue("Domain=.reddit.com;" in expire[2].second)
    }

    @Test
    fun expiresLemmyCookiesHostOnlyAndOnTheInstanceDomain() {
        val expire = AccountCookies.site("lemmy.world", instances).expire(listOf("jwt", "__Host-a"))
        assertEquals(
            listOf("https://lemmy.world", "https://lemmy.world", "https://lemmy.world"),
            expire.map { it.first },
        )
        assertTrue("Domain=lemmy.world;" in expire[1].second)
        assertTrue(expire[2].second.startsWith("__Host-a=; Path=/;"))
    }
}
