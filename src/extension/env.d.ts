type MessageSender = {
  id?: string;
  url?: string;
  tab?: { id?: number; cookieStoreId?: string };
};

declare const chrome: {
  runtime: {
    id: string;
    getURL(path: string): string;
    onMessage: {
      addListener(
        fn: (
          message: unknown,
          sender: MessageSender,
          reply: (answer: unknown) => void,
        ) => boolean | void,
      ): void;
    };
  };
  action: {
    onClicked: { addListener(fn: (tab: { id?: number }) => void): void };
  };
  tabs: {
    sendMessage(id: number, message: unknown): Promise<unknown>;
    create(options: { url: string }): Promise<unknown>;
  };
  /** Present once the optional `cookies` permission is granted. */
  cookies?: {
    getAllCookieStores(): Promise<{ id: string; tabIds: number[] }[]>;
  };
};
declare module "*.css";
