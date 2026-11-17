// Attach a design to Gemini the way Donepixel does it, through Chrome's DevTools
// protocol (chrome.debugger) - the protocol Playwright itself drives:
//
//   1. real (trusted) mouse clicks on "Upload & tools" and "Upload files";
//   2. Gemini opens its file picker, which the protocol intercepts
//      (Page.setInterceptFileChooserDialog) instead of showing;
//   3. the intercept names the exact <input type=file> Gemini opened, and the
//      design is put into THAT input.
//
// Synthetic clicks from a content script cannot do step 1 (Chrome opens a file
// picker only for a real user gesture), and Gemini keeps several unmarked file
// inputs mounted, which is why step 3 matters. The debugger is attached only
// for these few seconds; Chrome shows its "is debugging this browser" bar
// while it is.

import { GEMINI } from "../lib/geminiSelectors";

const PROTOCOL = "1.3";
// A fixed viewport so the page has a layout to click in, even in the
// minimized window the jobs run in.
const VIEWPORT = { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false };

type Target = chrome.debugger.Debuggee;

function send<T = unknown>(target: Target, method: string, params: Record<string, unknown> = {}): Promise<T> {
  return chrome.debugger.sendCommand(target, method, params) as Promise<T>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Centre of the first visible element matching one of `selectors`, or null. */
async function centreOf(target: Target, selectors: readonly string[]): Promise<{ x: number; y: number } | null> {
  const { result } = await send<{ result: { value?: { x: number; y: number } | null } }>(target, "Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      for (const sel of ${JSON.stringify(selectors)}) {
        for (const el of document.querySelectorAll(sel)) {
          const target = el.matches("button") ? el : (el.querySelector("button, [role=menuitem]") || el);
          target.scrollIntoView({ block: "center" });
          const r = target.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }
      return null;
    })()`,
  });
  return result.value ?? null;
}

async function waitForCentre(target: Target, selectors: readonly string[], ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const c = await centreOf(target, selectors);
    if (c) return c;
    await sleep(250);
  }
  return null;
}

async function click(target: Target, { x, y }: { x: number; y: number }): Promise<void> {
  const base = { x, y, button: "left", clickCount: 1 };
  await send(target, "Input.dispatchMouseEvent", { ...base, type: "mouseMoved" });
  await send(target, "Input.dispatchMouseEvent", { ...base, type: "mousePressed" });
  await send(target, "Input.dispatchMouseEvent", { ...base, type: "mouseReleased" });
}

/** Resolves with the backend node id of the file input Gemini opens, or null. */
function nextFileChooser(tabId: number, ms: number): { promise: Promise<number | null>; cancel: () => void } {
  let listener: ((source: Target, method: string, params?: object) => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (listener) chrome.debugger.onEvent.removeListener(listener);
    clearTimeout(timer);
  };
  const promise = new Promise<number | null>((resolve) => {
    listener = (source, method, params) => {
      if (source.tabId !== tabId || method !== "Page.fileChooserOpened") return;
      cancel();
      resolve((params as { backendNodeId?: number }).backendNodeId ?? null);
    };
    chrome.debugger.onEvent.addListener(listener);
    timer = setTimeout(() => { cancel(); resolve(null); }, ms);
  });
  return { promise, cancel };
}

export interface DebuggerAttachResult {
  ok: boolean;
  /** Which step stopped it, for the job's error trace. */
  step: string;
}

/**
 * Put `dataUrl` into the file input Gemini opens from its Upload menu, in tab
 * `tabId`. Never throws; `ok: false` lets the content script fall back.
 */
export async function attachViaDebugger(tabId: number, dataUrl: string, fileName: string): Promise<DebuggerAttachResult> {
  const target: Target = { tabId };
  try {
    await chrome.debugger.attach(target, PROTOCOL);
  } catch (e) {
    return { ok: false, step: `debugger-attach:${(e as Error).message}` };
  }
  try {
    await send(target, "Page.enable");
    await send(target, "DOM.enable");
    await send(target, "Runtime.enable");
    await send(target, "Emulation.setDeviceMetricsOverride", VIEWPORT);
    await send(target, "Emulation.setFocusEmulationEnabled", { enabled: true });
    await send(target, "Page.setInterceptFileChooserDialog", { enabled: true });

    const menu = await waitForCentre(target, GEMINI.uploadMenu, 8_000);
    if (!menu) return { ok: false, step: "dbg-no-menu" };
    await click(target, menu);

    let item = await waitForCentre(target, GEMINI.uploadFilesItem, 5_000);
    if (!item) {
      // A consent card can sit in front of the menu the first time.
      const consent = await centreOf(target, GEMINI.uploadConsent);
      if (consent) await click(target, consent);
      await click(target, menu);
      item = await waitForCentre(target, GEMINI.uploadFilesItem, 5_000);
    }
    if (!item) return { ok: false, step: "dbg-no-item" };

    let chooser = nextFileChooser(tabId, 6_000);
    await click(target, item);
    let nodeId = await chooser.promise;
    if (nodeId == null) {
      // The first click may only have shown the consent card.
      const consent = await centreOf(target, GEMINI.uploadConsent);
      if (consent) {
        await click(target, consent);
        const again = await waitForCentre(target, GEMINI.uploadFilesItem, 3_000);
        if (again) {
          chooser = nextFileChooser(tabId, 6_000);
          await click(target, again);
          nodeId = await chooser.promise;
        }
      }
    }
    if (nodeId == null) return { ok: false, step: "dbg-no-chooser" };

    const { object } = await send<{ object: { objectId?: string } }>(target, "DOM.resolveNode", { backendNodeId: nodeId });
    if (!object.objectId) return { ok: false, step: "dbg-no-input" };
    await send(target, "Runtime.callFunctionOn", {
      objectId: object.objectId,
      arguments: [{ value: dataUrl }, { value: fileName }],
      // Decoded by hand: Gemini's CSP may refuse a fetch() of a data: URL.
      functionDeclaration: `function (dataUrl, name) {
        const comma = dataUrl.indexOf(",");
        const mime = (/^data:([^;,]+)/.exec(dataUrl) || [])[1] || "image/png";
        const bin = atob(dataUrl.slice(comma + 1));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], name, { type: mime }));
        this.files = dt.files;
        this.dispatchEvent(new Event("input", { bubbles: true }));
        this.dispatchEvent(new Event("change", { bubbles: true }));
      }`,
    });
    return { ok: true, step: "dbg-delivered" };
  } catch (e) {
    return { ok: false, step: `dbg-error:${(e as Error).message.slice(0, 60)}` };
  } finally {
    await send(target, "Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => undefined);
    await chrome.debugger.detach(target).catch(() => undefined);
  }
}
