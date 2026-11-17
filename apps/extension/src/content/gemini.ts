// Content script - runs inside gemini.google.com tabs the extension opened.
// A thin DOM driver, like content/teepublic.ts: it runs ONE job on the page it
// is in and reports back. Which account, which job, retries and the queue all
// live in services/geminiJobs.ts. Every selector comes from lib/geminiSelectors.ts.
//
// The result goes back as a fire-and-forget GEMINI_JOB_DONE message, not as a
// sendResponse: a job can run for minutes, longer than the service worker stays
// awake waiting on a reply. GEMINI_JOB_PROGRESS pings in the meantime keep it
// awake and let it see the job is alive.

import {
  GEMINI_JOB_TIMEOUT_MS,
  GEMINI_LISTING_INSTRUCTION,
  parseGeminiListing,
  type GeminiErrorCode,
  type GeminiJobType,
  type InternalMessage,
} from "@teepublic/shared";
import { GEMINI, LIMIT_TEXT, q } from "../lib/geminiSelectors";
import { setFileInput } from "../lib/dom";
import { sleep } from "../lib/delays";

console.info("[gemini-cs] ready on", location.href);

class JobError extends Error {
  constructor(public code: GeminiErrorCode, message: string) {
    super(message);
  }
}

const PROGRESS_EVERY_MS = 15_000;
const SKIP_THINKING_AFTER_MS = 90_000;

let activeJobId: string | null = null;

chrome.runtime.onMessage.addListener((message: InternalMessage | { type: "PING" }, _sender, sendResponse) => {
  if (message?.type === "PING") {
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === "GEMINI_READ_ACCOUNT") {
    void readAccount().then(sendResponse);
    return true;
  }
  if (message?.type === "GEMINI_RUN") {
    if (activeJobId) {
      sendResponse({ ok: false, error: `busy with ${activeJobId}` });
      return;
    }
    activeJobId = message.jobId;
    // Acknowledge now; the outcome arrives as GEMINI_JOB_DONE.
    sendResponse({ ok: true });
    void runJob(message).finally(() => { activeJobId = null; });
    return;
  }
});

// ── Account ───────────────────────────────────────────────────────────────

/** Signed-in address from the account link's aria-label, or null. */
function signedInEmail(): string | null {
  for (const sel of GEMINI.accountLink) {
    for (const a of document.querySelectorAll(sel)) {
      const m = (a.getAttribute("aria-label") || "").match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
      if (m) return m[0].toLowerCase();
    }
  }
  return null;
}

/** Wait for the page to say who is signed in. */
async function readAccount(timeoutMs = 20_000): Promise<{ signedIn: boolean; email: string | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const email = signedInEmail();
    if (email) return { signedIn: true, email };
    if (q(GEMINI.signedOut)) return { signedIn: false, email: null };
    await sleep(500);
  }
  return { signedIn: false, email: null };
}

// ── The job ───────────────────────────────────────────────────────────────

async function runJob(msg: Extract<InternalMessage, { type: "GEMINI_RUN" }>): Promise<void> {
  const { jobId } = msg;
  const started = Date.now();
  const deadline = started + GEMINI_JOB_TIMEOUT_MS;
  const progress = (step: string) => {
    try { chrome.runtime.sendMessage({ type: "GEMINI_JOB_PROGRESS", jobId, step }, () => void chrome.runtime.lastError); } catch { /* SW restarting */ }
  };
  const ticker = setInterval(() => progress("working"), PROGRESS_EVERY_MS);

  try {
    progress("checking account");
    const account = await readAccount();
    if (!account.signedIn) throw new JobError("NOT_SIGNED_IN", "This Google account is not signed in to Gemini.");
    if (msg.expectedEmail && account.email !== msg.expectedEmail.toLowerCase()) {
      throw new JobError(
        "NOT_SIGNED_IN",
        `Expected ${msg.expectedEmail} but this slot is now ${account.email ?? "a different account"}. Refresh the account list.`,
      );
    }

    progress("opening temporary chat");
    await enableTemporaryChat();

    if (msg.imageDataUrl) {
      progress("attaching image");
      await attachImage(msg.imageDataUrl, deadline);
    }

    progress("sending prompt");
    const prompt = msg.jobType === "listing" ? `${msg.prompt}\n\n${GEMINI_LISTING_INSTRUCTION}` : msg.prompt;
    const before = document.querySelectorAll(GEMINI.response).length;
    await submitPrompt(prompt);

    progress("waiting for Gemini");
    const answer = await waitForAnswer(msg.jobType, before, started, deadline);

    if (msg.jobType === "listing") {
      const listing = parseGeminiListing(answer.text);
      if (!listing) throw new JobError("UNKNOWN", `Gemini did not answer with the listing JSON: ${answer.text.slice(0, 160)}`);
      done({ type: "GEMINI_JOB_DONE", jobId, ok: true, listing });
    } else {
      if (!answer.image) throw new JobError("UNKNOWN", `Gemini answered with text instead of an image: ${answer.text.slice(0, 160)}`);
      progress("saving image");
      const imageDataUrl = await imageToDataUrl(answer.image);
      done({ type: "GEMINI_JOB_DONE", jobId, ok: true, imageDataUrl });
    }
  } catch (e) {
    const code: GeminiErrorCode = e instanceof JobError ? e.code : "UNKNOWN";
    const error = e instanceof Error ? e.message : String(e);
    console.warn(`[gemini-cs] job ${jobId} failed: ${code} ${error}`);
    done({ type: "GEMINI_JOB_DONE", jobId, ok: false, code, error });
  } finally {
    clearInterval(ticker);
  }
}

function done(message: Extract<InternalMessage, { type: "GEMINI_JOB_DONE" }>): void {
  try {
    chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
  } catch (e) {
    console.warn("[gemini-cs] GEMINI_JOB_DONE send failed:", e);
  }
}

/** Wait for any candidate to appear. */
async function waitFor<T extends Element = HTMLElement>(candidates: readonly string[], timeoutMs: number): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = q<T>(candidates);
    if (el) return el;
    await sleep(300);
  }
  return null;
}

/** Close promo dialogs and menus that would swallow a click. Never clicks a
 *  button inside them: Escape and the backdrop are the only things touched. */
function dismissDialogs(): void {
  if (!document.querySelector(GEMINI.dialog) && !document.querySelector(".cdk-overlay-backdrop")) return;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  document.querySelectorAll<HTMLElement>(".cdk-overlay-backdrop").forEach((b) => b.click());
}

async function enableTemporaryChat(): Promise<void> {
  const toggle = await waitFor<HTMLElement>(GEMINI.tempChatToggle, 15_000);
  if (!toggle) {
    if (q(GEMINI.signedOut)) throw new JobError("NOT_SIGNED_IN", "This Google account is not signed in to Gemini.");
    throw new JobError("TEMP_CHAT_UNAVAILABLE", "Gemini does not offer Temporary chat on this account.");
  }
  dismissDialogs();
  // A fresh /app load opens in a normal chat, so one click turns Temporary on.
  // Where the button exposes its state, make sure it really is on.
  if (toggle.getAttribute("aria-pressed") !== "true") toggle.click();
  await sleep(800);
  if (toggle.getAttribute("aria-pressed") === "false") {
    toggle.click();
    await sleep(800);
    if (toggle.getAttribute("aria-pressed") === "false") {
      throw new JobError("TEMP_CHAT_UNAVAILABLE", "Temporary chat did not turn on.");
    }
  }
}

function dataUrlToFile(dataUrl: string): File {
  const [head, b64] = dataUrl.split(",", 2);
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "image/png";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg") ?? "png";
  return new File([bytes], `design.${ext}`, { type: mime });
}

function attachmentThumbs(): HTMLImageElement[] {
  for (const sel of GEMINI.attachmentThumb) {
    const imgs = [...document.querySelectorAll<HTMLImageElement>(sel)];
    if (imgs.length) return imgs;
  }
  return [];
}

/**
 * The design is attached once its thumbnail is in the composer with a source.
 * Not "decoded": in a minimized window Chrome may never decode it, so
 * naturalWidth can stay 0 for an upload that is fine. Gemini keeps Send
 * disabled until the upload ends, and submitPrompt waits for that.
 */
function attachmentReady(): boolean {
  const imgs = attachmentThumbs();
  return imgs.length > 0 && imgs.every((i) => i.naturalWidth > 0 || !!i.getAttribute("src"));
}

/** A short what-happened line for the error, so a failure names its step. */
function attachTrace(steps: string[]): string {
  const thumbs = attachmentThumbs();
  const accepts = [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')]
    .map((i) => (i.accept || "any").slice(0, 24));
  return `[${steps.join(", ")}; thumbs=${thumbs.length}${thumbs.length ? `(w=${thumbs[0].naturalWidth},src=${thumbs[0].getAttribute("src") ? "yes" : "no"})` : ""}; fileInputs=${accepts.length}(${accepts.join(" | ")})]`;
}

/**
 * Attach the design through Gemini's own file input, with a DataTransfer -
 * the OS file picker never opens. Opening the upload menu is what makes Gemini
 * mount its input; if it still is not there, paste and then drop the file on
 * the composer, both of which Gemini also accepts.
 */
/**
 * Hand `file` to the page-world hook, click `item`, and resolve true once the
 * hook reports it filled Gemini's file input (false after 3 s).
 */
/**
 * What a real click delivers - pointer and mouse down/up, then click - sent to
 * the innermost button. Gemini's menu items are wrappers around the element
 * that owns the handler, and some handlers listen for pointerdown, so a bare
 * el.click() on the wrapper can do nothing.
 */
function clickLikeUser(el: HTMLElement): void {
  const target = el.matches("button") ? el : el.querySelector<HTMLElement>("button, [role='menuitem']") ?? el;
  const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
  target.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerType: "mouse", isPrimary: true }));
  target.dispatchEvent(new MouseEvent("mousedown", opts));
  target.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerType: "mouse", isPrimary: true }));
  target.dispatchEvent(new MouseEvent("mouseup", opts));
  target.dispatchEvent(new MouseEvent("click", opts));
}

function armAndClick(file: File, item: HTMLElement): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      if (!ok) window.postMessage({ source: "higgstee-gemini", type: "DISARM" }, "*");
      resolve(ok);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== "higgstee-gemini") return;
      // Click only once the hook holds the file: postMessage is async, and a
      // click that beats it would reach Gemini's input with nothing armed.
      if (e.data.type === "ARMED") clickLikeUser(item);
      else if (e.data.type === "FILE_DELIVERED") done(true);
    };
    const timer = setTimeout(() => done(false), 3_000);
    window.addEventListener("message", onMessage);
    window.postMessage({ source: "higgstee-gemini", type: "ARM_FILE", file }, "*");
  });
}

async function attachImage(dataUrl: string, deadline: number): Promise<void> {
  const file = dataUrlToFile(dataUrl);
  dismissDialogs();

  // 1. Gemini's own path: Upload & tools -> Upload files. That item calls
  //    input.click() on a file input; content/geminiMain.ts (page world)
  //    answers that call with the armed file instead of an OS picker.
  const steps: string[] = [];

  // 0. Donepixel's way: real clicks + file-chooser interception through
  //    chrome.debugger, run by the service worker (services/geminiDebugger.ts).
  const viaDebugger = await new Promise<{ ok: boolean; step: string }>((resolve) => {
    chrome.runtime.sendMessage(
      { type: "GEMINI_ATTACH_DEBUGGER", imageDataUrl: dataUrl, fileName: file.name },
      (r) => resolve(chrome.runtime.lastError || !r ? { ok: false, step: "dbg-no-reply" } : r),
    );
  });
  steps.push(viaDebugger.step);
  let delivered = viaDebugger.ok;
  if (delivered) {
    for (let i = 0; i < 20 && !attachmentReady(); i++) await sleep(300);
  }

  const menu = delivered ? null : await waitFor<HTMLElement>(GEMINI.uploadMenu, 8_000);
  if (!delivered) steps.push(menu ? "menu" : "no-menu");
  if (menu) {
    clickLikeUser(menu);
    let item = await waitFor<HTMLElement>(GEMINI.uploadFilesItem, 5_000);
    if (!item) {
      // A consent card can sit in front of the menu the first time.
      q<HTMLElement>(GEMINI.uploadConsent)?.click();
      clickLikeUser(menu);
      item = await waitFor<HTMLElement>(GEMINI.uploadFilesItem, 5_000);
    }
    steps.push(item ? "item" : "no-item");
    if (item) {
      delivered = await armAndClick(file, item);
      if (!delivered) {
        // The first click may only have shown the consent card.
        q<HTMLElement>(GEMINI.uploadConsent)?.click();
        await sleep(400);
        const again = q<HTMLElement>(GEMINI.uploadFilesItem);
        if (again) delivered = await armAndClick(file, again);
      }
      steps.push(delivered ? "hooked" : "not-hooked");
    }
  }

  // 2. Gemini keeps several file inputs mounted and which one is the image
  //    uploader is not marked, so each image-accepting one is tried in turn
  //    until a thumbnail shows.
  const inputs = delivered
    ? []
    : [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')]
        .filter((i) => !i.accept || /image/i.test(i.accept));
  for (const [n, input] of inputs.entries()) {
    steps.push(`input${n + 1}/${inputs.length}`);
    await setFileInput(input, file);
    for (let i = 0; i < 8 && !attachmentReady(); i++) await sleep(300);
    if (attachmentReady()) {
      delivered = true;
      break;
    }
  }

  const composer = q<HTMLElement>(GEMINI.composer);
  if (delivered) {
    // Gemini has the file; just wait for the thumbnail below.
  } else if (composer) {
    steps.push("paste");
    const dt = new DataTransfer();
    dt.items.add(file);
    composer.focus();
    composer.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(1500);
    if (!attachmentReady()) {
      steps.push("drop");
      for (const type of ["dragenter", "dragover", "drop"]) {
        composer.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      }
    }
  } else {
    throw new JobError("SELECTOR_NOT_FOUND", "Could not find Gemini's upload control or message box.");
  }
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));

  const until = Math.min(deadline, Date.now() + 45_000);
  while (Date.now() < until) {
    q<HTMLElement>(GEMINI.uploadConsent)?.click();
    if (attachmentReady()) return;
    await sleep(500);
  }
  throw new JobError("SELECTOR_NOT_FOUND", `The image did not attach to the Gemini message. ${attachTrace(steps)}`);
}

function composerText(el: HTMLElement): string {
  return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
}

function isGenerating(): boolean {
  const btn = q<HTMLElement>(GEMINI.sendButton);
  if (!btn) return false;
  const icon = btn.querySelector(GEMINI.sendButtonIcon);
  const name = (icon?.getAttribute("fonticon") || icon?.getAttribute("data-mat-icon-name") || icon?.textContent || "").trim().toLowerCase();
  return /stop/.test(name) || /stop/i.test(btn.getAttribute("data-test-id") || "") || btn.classList.contains("stop");
}

/**
 * Put the prompt into Gemini's Quill editor so Quill's own model holds it -
 * text that is only in the DOM gets dropped on send (the image goes alone).
 */
async function fillComposer(composer: HTMLElement, prompt: string): Promise<boolean> {
  const head = prompt.replace(/\s+/g, " ").trim().slice(0, 30);
  const landed = () => composerText(composer).includes(head);
  const selectAllIn = () => {
    composer.focus();
    const range = document.createRange();
    range.selectNodeContents(composer);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  // 1. Native editing input - what typing produces.
  selectAllIn();
  document.execCommand("insertText", false, prompt);
  await sleep(300);
  if (landed()) return true;

  // 2. A paste: Quill's clipboard module turns it into real editor content.
  selectAllIn();
  const data = new DataTransfer();
  data.setData("text/plain", prompt);
  composer.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  await sleep(300);
  if (landed()) return true;

  // 3. Quill's own markup; its MutationObserver syncs the model from the DOM.
  composer.innerHTML = prompt
    .split("\n")
    .map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;") || "<br>"}</p>`)
    .join("");
  composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  await sleep(300);
  return landed();
}

async function submitPrompt(prompt: string): Promise<void> {
  dismissDialogs();
  const composer = await waitFor<HTMLElement>(GEMINI.composer, 10_000);
  if (!composer) throw new JobError("SELECTOR_NOT_FOUND", "Could not find the Gemini message box.");

  if (!(await fillComposer(composer, prompt))) {
    throw new JobError("SELECTOR_NOT_FOUND", "The prompt did not land in the Gemini message box.");
  }

  const before = document.querySelectorAll(GEMINI.response).length;
  // Re-query the box each time: Gemini can re-render it after a send.
  const box = () => q<HTMLElement>(GEMINI.composer) ?? composer;
  const sent = () => isGenerating() || document.querySelectorAll(GEMINI.response).length > before || !composerText(box());
  const enter = () =>
    box().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));

  // The send button is clicked AT MOST ONCE. While Gemini answers, that same
  // button is the Stop button - a second click would cancel the answer.
  // After an attachment it stays disabled until the upload ends.
  let clicked = false;
  for (let i = 0; i < 20 && !clicked; i++) {
    const btn = q<HTMLButtonElement>(GEMINI.sendButton);
    if (btn && !isGenerating() && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") {
      btn.click();
      clicked = true;
    } else {
      await sleep(500);
    }
  }
  if (!clicked) enter();

  for (let i = 0; i < 12; i++) {
    if (sent()) return;
    await sleep(800);
    // Retry with Enter only - it sends, but never stops a running answer.
    if (i === 5) enter();
  }
  throw new JobError("SELECTOR_NOT_FOUND", "The prompt stayed in the Gemini message box, unsent.");
}

interface Answer {
  text: string;
  image: HTMLImageElement | null;
}

function lastResponse(): Element | null {
  const all = document.querySelectorAll(GEMINI.response);
  return all.length ? all[all.length - 1] : null;
}

function readAnswer(): Answer {
  const last = lastResponse();
  if (!last) return { text: "", image: null };
  const content = last.querySelector<HTMLElement>(GEMINI.responseText);
  const text = ((content ?? (last as HTMLElement)).innerText || "").trim();
  const images = [...last.querySelectorAll<HTMLImageElement>("img")].filter(
    (im) => im.naturalWidth >= GEMINI.minGeneratedImageWidth || /googleusercontent\.com|^blob:/.test(im.src),
  );
  images.sort((a, b) => b.naturalWidth - a.naturalWidth);
  return { text, image: images[0] ?? null };
}

function answerFinished(before: number): boolean {
  if (document.querySelectorAll(GEMINI.response).length <= before) return false;
  if (isGenerating()) return false;
  const last = lastResponse();
  if (!last) return false;
  const scope = last.nextElementSibling ? [last, last.nextElementSibling] : [last];
  return scope.some((r) => r.querySelector(GEMINI.responseDone));
}

/**
 * Wait for Gemini's answer. A MutationObserver re-checks on every change to the
 * page; a slow interval backs it up, because Chrome throttles timers - not DOM
 * mutations - in background tabs, and a finished answer may stop mutating.
 */
function waitForAnswer(jobType: GeminiJobType, before: number, started: number, deadline: number): Promise<Answer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let finishedAt = 0;
    let skipped = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearInterval(interval);
      clearTimeout(timer);
      fn();
    };

    const check = () => {
      if (settled) return;
      const answer = readAnswer();
      const hasNew = document.querySelectorAll(GEMINI.response).length > before;
      if (hasNew && LIMIT_TEXT.test(answer.text)) {
        return finish(() => reject(new JobError("LIMIT_REACHED", "This Google account has reached its Gemini limit.")));
      }
      if (!skipped && Date.now() - started > SKIP_THINKING_AFTER_MS) {
        const skip = document.querySelector<HTMLElement>(GEMINI.skipThinking);
        if (skip) { skip.click(); skipped = true; }
      }
      if (jobType === "listing" && hasNew && !isGenerating() && parseGeminiListing(answer.text)) {
        return finish(() => resolve(answer));
      }
      if (!answerFinished(before)) return;
      if (jobType === "listing") return finish(() => resolve(answer));
      // An image answer is "finished" a moment before its <img> loads.
      if (answer.image) return finish(() => resolve(answer));
      finishedAt ||= Date.now();
      if (Date.now() - finishedAt > 20_000) finish(() => resolve(answer));
    };

    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    const interval = setInterval(check, 1000);
    const timer = setTimeout(
      () => finish(() => reject(new JobError("TIMEOUT", "Gemini did not finish answering within 3 minutes."))),
      Math.max(0, deadline - Date.now()),
    );
    check();
  });
}

// ── Image extraction ──────────────────────────────────────────────────────

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function canvasDataUrl(img: HTMLImageElement): string | null {
  if (!img.naturalWidth) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png"); // throws if the canvas is cross-origin tainted
  } catch {
    return null;
  }
}

/**
 * The generated image as a data URL. Order: the full-size variant of a
 * googleusercontent URL (=s0), then the URL as shown - fetched here, and if the
 * page's CORS refuses, by the service worker, which has host access to the
 * image host. A blob: image is read off a canvas: Gemini revokes the blob URL
 * once the <img> has loaded, but the pixels stay in the element.
 */
async function imageToDataUrl(img: HTMLImageElement): Promise<string> {
  const src = img.currentSrc || img.src;
  if (/^https?:/.test(src)) {
    const base = src.replace(/=[^=/]*$/, "");
    const variants = [...new Set([`${base}=s0`, src])];
    for (const url of variants) {
      try {
        const res = await fetch(url, { credentials: "include" });
        if (res.ok) {
          const blob = await res.blob();
          if (blob.size > 1000 && blob.type.startsWith("image/")) return await blobToDataUrl(blob);
        }
      } catch { /* CORS - ask the service worker */ }
      const viaWorker = await new Promise<{ ok: boolean; dataUrl?: string }>((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: "GEMINI_FETCH_IMAGE", url }, (r) => {
            void chrome.runtime.lastError;
            resolve(r ?? { ok: false });
          });
        } catch {
          resolve({ ok: false });
        }
      });
      if (viaWorker.ok && viaWorker.dataUrl) return viaWorker.dataUrl;
    }
  }
  const fromCanvas = canvasDataUrl(img);
  if (fromCanvas) return fromCanvas;
  throw new JobError("UNKNOWN", "Gemini made an image, but it could not be read back.");
}
