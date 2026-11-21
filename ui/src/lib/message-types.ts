/** Renderer metadata for one immutable user-message family. */
export interface MessageVersions {
  messageId: string;
  variantId: string;
  variants: string[];
  index: number;
  count: number;
}

export interface UserMessageItem {
  kind: "message";
  id: string;
  text: string;
  actor?: "user" | "twin";
  at?: string;
  versions?: MessageVersions;
}

/** A separate composer draft keeps an unsent follow-up safe while revising history. */
export interface ComposerEdit {
  key: string;
  messageId: string;
}
