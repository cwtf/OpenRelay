declare const chrome: {
  runtime: {
    getURL(path: string): string;
    onMessage: { addListener(fn: (message: unknown) => void): void };
  };
  action: {
    onClicked: { addListener(fn: (tab: { id?: number }) => void): void };
  };
  tabs: {
    sendMessage(id: number, message: unknown): Promise<unknown>;
    create(options: { url: string }): Promise<unknown>;
  };
};
declare module "*.css";
