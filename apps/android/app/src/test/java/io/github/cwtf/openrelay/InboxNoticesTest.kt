package io.github.cwtf.openrelay

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class InboxNoticesTest {
    @Test
    fun redditCommentRepliesOpenTheirContextAndMessagesTheirThread() {
        val data = JSONObject(
            """
            {"kind":"Listing","data":{"children":[
              {"kind":"t1","data":{"name":"t1_abc","author":"alice","subject":"comment reply",
                "body":"Thanks,\n\nthat helped","context":"/r/android/comments/xyz/title/abc/?context=3",
                "subreddit":"android","was_comment":true,"new":true,"created_utc":1700000000.0}},
              {"kind":"t1","data":{"name":"t1_def","author":"bob","subject":"post reply",
                "body":"Hi","context":"/r/android/comments/xyz/title/def/?context=3",
                "subreddit":"android","was_comment":true,"new":true,"created_utc":1700000001.0}},
              {"kind":"t4","data":{"name":"t4_m1","author":null,"subreddit_name_prefixed":"r/mods",
                "subject":"Welcome","body":"Hello","context":"","subreddit":null,
                "was_comment":false,"new":true,"created_utc":1700000002.0}},
              {"kind":"t1","data":{"name":"bad id","new":true}}
            ]}}
            """,
        )
        val notices = redditNotices(data)
        assertEquals(3, notices.size)
        assertEquals("reddit:t1_abc", notices[0].key)
        assertEquals("u/alice replied to your comment", notices[0].title)
        assertEquals("Thanks, that helped", notices[0].text)
        assertEquals("r/android", notices[0].site)
        assertEquals("https://www.reddit.com/r/android/comments/xyz/title/abc/?context=3", notices[0].url)
        assertEquals(1_700_000_000_000L, notices[0].time)
        assertEquals("u/bob replied to your post", notices[1].title)
        assertEquals("r/mods: Welcome", notices[2].title)
        assertEquals("https://www.reddit.com/message/messages/m1", notices[2].url)
    }

    @Test
    fun redditContextFromAnotherSiteIsNotFollowed() {
        val data = JSONObject(
            """
            {"data":{"children":[{"data":{"name":"t1_abc","author":"a","subject":"comment reply",
              "body":"x","context":"//evil.example/r/x","was_comment":true}}]}}
            """,
        )
        assertEquals("https://www.reddit.com/message/inbox", redditNotices(data)[0].url)
    }

    @Test
    fun lemmyKeepsUnreadRepliesMentionsAndMessagesToYou() {
        val replies = JSONObject(
            """
            {"replies":[
              {"comment_reply":{"id":7,"read":false},
               "comment":{"id":70,"content":"Top level","path":"0.70","published":"2024-01-02T03:04:05.000000Z"},
               "creator":{"name":"carol","local":false,"actor_id":"https://beehaw.org/u/carol"},
               "post":{"name":"A post"},"community":{"name":"technology"}},
              {"comment_reply":{"id":8,"read":true},"comment":{"id":80,"content":"Read","path":"0.1.80"}}
            ]}
            """,
        )
        val mentions = JSONObject(
            """
            {"mentions":[{"person_mention":{"id":9,"read":false},
              "comment":{"id":90,"content":"hey @me","path":"0.5.90","published":"2024-01-02T03:04:06Z"},
              "creator":{"name":"dave","local":true},"post":{"name":"Other"}}]}
            """,
        )
        val messages = JSONObject(
            """
            {"private_messages":[
              {"private_message":{"id":11,"content":"Hi","read":false,"recipient_id":42,
                "published":"2024-01-02T03:04:07.000000"},"creator":{"name":"erin","local":true}},
              {"private_message":{"id":12,"content":"Sent by me","read":false,"recipient_id":5},
                "creator":{"name":"me","local":true}}
            ]}
            """,
        )
        val notices = lemmyNotices("lemmy.world", replies, mentions, messages, 42)
        assertEquals(
            listOf("lemmy:lemmy.world:reply:7", "lemmy:lemmy.world:mention:9", "lemmy:lemmy.world:message:11"),
            notices.map { it.key },
        )
        assertEquals("@carol@beehaw.org replied to your post in “A post”", notices[0].title)
        assertEquals("c/technology", notices[0].site)
        assertEquals("https://lemmy.world/comment/70", notices[0].url)
        assertEquals("@dave mentioned you in “Other”", notices[1].title)
        assertEquals("Message from @erin", notices[2].title)
        assertEquals("https://lemmy.world/inbox", notices[2].url)
        // Lemmy 0.19 may leave the zone off; it's UTC.
        assertEquals(1_704_164_647_000L, notices[2].time)
    }
}
