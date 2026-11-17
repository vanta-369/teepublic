// Every gemini.google.com selector, in one place - like lib/selectors.ts is for
// TeePublic. When Gemini changes its page and jobs start failing with
// SELECTOR_NOT_FOUND, fix it HERE; content/gemini.ts reads nothing else.
//
// Each entry is an ordered candidate list (first match wins). Gemini is
// localised into every UI language, so nothing below matches visible button
// text: only data-test-id hooks, jslog ids, Material icon names, link targets
// and element structure, which are the same in every locale. The one exception
// is LIMIT_TEXT, which reads Gemini's own message (see the note there).
//
// Provenance: these hooks come from another desktop Gemini tool's source, whose
// comments date them to live observations in September 2026. They were NOT
// verified against the live page while writing this file, and no test covers
// them - nothing in this repo can sign in to Google - so expect the first live
// run to need adjustments here, and treat a SELECTOR_NOT_FOUND after a Gemini
// redesign as routine maintenance.

export const GEMINI = {
  /** The page for one signed-in account. */
  appUrl: (accountIndex: number) => `https://gemini.google.com/u/${accountIndex}/app`,
  /** Google's "add another account" page, which returns to Gemini afterwards. */
  addAccountUrl:
    "https://accounts.google.com/AddSession?continue=" + encodeURIComponent("https://gemini.google.com/app"),

  /** Exists only while signed in; its aria-label carries the address:
   *  "Google Account: Name (a@b.c)" in English, same shape in every locale. */
  accountLink: ['a[href*="accounts.google.com/SignOutOptions"]', 'a[href*="SignOutOptions"]'],

  /** Present only when signed OUT. Google renamed the avatar's test-id once
   *  (mavatar-sign-in-button -> mavatar-sign-in-icon-button), hence the prefix. */
  signedOut: [
    '[data-test-id="signed-out-disclaimer"]',
    '[data-test-id^="mavatar-sign-in"]',
    'a[href*="accounts.google.com/ServiceLogin"]',
    'a[href*="accounts.google.com/signin"]',
    'a[href*="accounts.google.com/v3/signin"]',
  ],

  /** The Temporary chat toggle (signed-in only; some Workspace and under-18
   *  accounts never get it -> TEMP_CHAT_UNAVAILABLE). */
  tempChatToggle: ['[data-test-id="temp-chat-button-container"] button', '[data-test-id="temp-chat-button-container"]'],

  /** The message box: a Quill contenteditable inside a stable wrapper. */
  composer: [
    '[data-test-id="textarea-inner"] [contenteditable="true"]',
    "rich-textarea .ql-editor",
    '[data-test-id="textarea-inner"]',
    '[contenteditable="true"][role="textbox"]',
  ],

  /** The send button. While generating, the SAME button turns into Stop. */
  sendButton: ['[data-test-id="send-button-container"] button', "button.send-button"],
  /** Icon inside the send button; its NAME ("send"/"stop") is code, not UI text. */
  sendButtonIcon: "mat-icon, [data-mat-icon-name], [fonticon]",

  /** "Upload & tools" menu, then its "Upload files" item. Opening the menu is
   *  what makes Gemini mount its hidden <input type=file>. */
  uploadMenu: ['button[jslog*="300142"]', '[data-test-id="uploader-button"]', 'button[jslog*="uploader"]'],
  uploadFilesItem: ['[data-test-id="local-images-files-uploader-button"]'],
  fileInput: ['input[type="file"][accept*="image"]', 'input[type="file"]'],
  /** One-time "images you upload may be reviewed" consent. */
  uploadConsent: ['[data-test-id="upload-image-agree-button"]'],
  /** A finished attachment thumbnail in the composer. */
  attachmentThumb: ['img[alt="attachment"]', '[data-test-id="file-preview"] img', "uploader-file-preview img"],

  /** One per answer; the last one is the answer to our prompt. */
  response: "model-response",
  responseText: "message-content",
  /** Rendered under an answer only once it is finished. */
  responseDone: "message-actions, copy-button, regenerate-button, thumb-up-button",
  /** "Answer now" while a thinking model deliberates. */
  skipThinking: '[data-test-id="skip-button"]',
  /** Generated images are at least this wide; smaller <img>s are avatars/icons. */
  minGeneratedImageWidth: 256,

  /** Modal dialogs Gemini may show over the page (new-feature promos etc.). */
  dialog: '[role="dialog"], [role="alertdialog"], mat-dialog-container, .mat-mdc-dialog-container',
} as const;

/**
 * Gemini's usage-limit message. Unlike everything above this IS visible text,
 * because there is no stable hook for it: Gemini states the limit in prose, in
 * the reply area. English only - on another UI language a limit reads as a
 * TIMEOUT or a non-JSON answer instead of LIMIT_REACHED. Kept narrow on purpose:
 * a false positive would mark a working account as exhausted.
 */
export const LIMIT_TEXT =
  /\b(?:you(?:'|’)ve reached your (?:daily |current )?(?:limit|quota)|reached (?:your|the) (?:daily |usage )?limit|usage limit|limit (?:resets|will reset)|come back (?:tomorrow|later) (?:to|for) (?:create|generate|make) (?:more )?images?)\b/i;

/** First element matching any candidate, or null. */
export function q<T extends Element = HTMLElement>(candidates: readonly string[] | string, root: ParentNode = document): T | null {
  for (const sel of typeof candidates === "string" ? [candidates] : candidates) {
    const el = root.querySelector<T>(sel);
    if (el) return el;
  }
  return null;
}
