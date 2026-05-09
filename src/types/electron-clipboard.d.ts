export {};

declare global {
  interface Window {
    desktopClipboard?: {
      readText: () => Promise<string>;
      writeText: (text: string) => Promise<void>;
    };
  }
}
