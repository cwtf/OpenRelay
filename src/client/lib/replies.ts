import type { CommentNode } from "../../shared/api.ts";

/**
 * A comment with the replies its "more replies" row just loaded. Reddit's
 * JSON sends all of them again, its HTML only those after the ones already
 * shown, so replies already shown stay unless they arrived again. It offers
 * more only while each load adds some, so a source that keeps saying "more"
 * can't loop.
 */
export function withMoreReplies(
  node: CommentNode,
  loaded: { replies: CommentNode[]; more: boolean },
): CommentNode {
  const arrived = new Set(loaded.replies.map((reply) => reply.id));
  const replies = [
    ...node.replies.filter((reply) => !arrived.has(reply.id)),
    ...loaded.replies,
  ];
  return {
    ...node,
    replies,
    moreReplies: loaded.more && replies.length > node.replies.length,
  };
}
