import { createContext, useContext, type ReactNode } from 'react';
import type { FeedSort, PostSummary } from '../../shared/api';

export type ViewerItem =
  | { kind: 'image'; url: string; width?: number; height?: number }
  | {
      kind: 'video';
      mp4?: string;
      hls?: string;
      poster?: string;
      width: number;
      height: number;
      isGif: boolean;
    };

export type ViewerSpec = {
  items: ViewerItem[];
  index: number;
  title?: string;
  permalink?: string;
  sourceUrl?: string;
  origin?: DOMRect | null;
};

export type SheetRenderer = (close: () => void) => ReactNode;

export type Session = {
  home: string;
  username: string | null;
  loggedIn: boolean;
  featured: string[];
  defaultSort: FeedSort;
};

export type Nav = {
  session: Session;
  /** Community currently shown in the base feed. */
  current: string;
  openPost: (post: PostSummary | string) => void;
  openCommunity: (name: string) => void;
  openSearch: () => void;
  /** Account screens, after Relay's drawer destinations. */
  openProfile: (user: string) => void;
  openInbox: () => void;
  openModerator: () => void;
  openFriends: () => void;
  openSubmit: (sub?: string) => void;
  openCompose: (draft?: { to?: string; subject?: string }) => void;
  back: () => void;
  openLink: (href: string) => void;
  openMedia: (spec: ViewerSpec) => void;
  openSheet: (render: SheetRenderer) => void;
  openDrawer: () => void;
  openSettings: () => void;
};

export const NavContext = createContext<Nav | null>(null);

export const useNav = (): Nav => {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav must be used inside NavContext');
  return nav;
};
