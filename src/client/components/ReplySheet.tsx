import type { CommentNode } from "../../shared/api";

import { openUrl } from "../lib/platform";
import { Sheet } from "./Sheet";

type ReplySheetProps = {
  parentId: string;
  permalink: string;
  quote: string;
  author: string;
  loggedIn: boolean;
  onPosted: (comment: CommentNode) => void;
  onClosed: () => void;
};
export const ReplySheet = ({
  author,
  quote,
  permalink,
  onClosed,
}: ReplySheetProps) => {
  return (
    <Sheet title={`Reply to ${author}`} onClosed={onClosed}>
      {(close) => (
        <div className="composer">
          {quote ? <div className="quote">{quote}</div> : null}
          <p>Reply using Reddit’s own editor and your signed-in account.</p>
          <div className="row-actions">
            <button type="button" className="btn is-text" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                openUrl(permalink);
                close();
              }}
            >
              Reply on Reddit
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
};
