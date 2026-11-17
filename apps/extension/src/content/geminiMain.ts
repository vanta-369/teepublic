// Runs in gemini.google.com's own JS world (manifest "world": "MAIN"), from
// document_start. Its one job: let content/gemini.ts attach a design without
// the OS file picker.
//
// Gemini's "Upload files" item makes a hidden <input type=file> and calls
// input.click(). Chrome only opens a picker for a real user gesture, so from
// automation that call does nothing. This file arms ONE file at a time; the
// next file-input click (or showPicker) gets that file and a change event
// instead of a picker - what Playwright's filechooser interception does for
// Donepixel. With nothing armed, every input behaves normally.

const SOURCE = "higgstee-gemini";
let armed: File | null = null;
let armedUntil = 0;

window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  const d = e.data as { source?: string; type?: string; file?: unknown } | null;
  if (d?.source !== SOURCE) return;
  if (d.type === "ARM_FILE" && d.file instanceof File) {
    armed = d.file;
    armedUntil = Date.now() + 15_000;
    window.postMessage({ source: SOURCE, type: "ARMED" }, "*");
  } else if (d.type === "DISARM") {
    armed = null;
  }
});

function deliver(input: HTMLInputElement): boolean {
  if (input.type !== "file" || !armed || Date.now() > armedUntil) return false;
  const dt = new DataTransfer();
  dt.items.add(armed);
  armed = null;
  input.files = dt.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  window.postMessage({ source: SOURCE, type: "FILE_DELIVERED" }, "*");
  return true;
}

// Patched on HTMLElement, where click() actually lives, so a page that calls
// HTMLElement.prototype.click.call(input) is caught as well as input.click().
const nativeClick = HTMLElement.prototype.click;
HTMLElement.prototype.click = function (this: HTMLElement) {
  if (this instanceof HTMLInputElement && deliver(this)) return;
  return nativeClick.call(this);
};

// A synthetic click event dispatched on an input that IS in the document.
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t instanceof HTMLInputElement && deliver(t)) e.preventDefault();
}, true);

// The File System Access picker, if Gemini uses it instead of an input.
type PickerWindow = { showOpenFilePicker?: (...args: unknown[]) => Promise<unknown> };
const nativeOpenPicker = (window as PickerWindow).showOpenFilePicker;
if (nativeOpenPicker) {
  (window as PickerWindow).showOpenFilePicker = function (...args: unknown[]) {
    if (armed && Date.now() <= armedUntil) {
      const file = armed;
      armed = null;
      window.postMessage({ source: SOURCE, type: "FILE_DELIVERED" }, "*");
      return Promise.resolve([{ kind: "file", name: file.name, getFile: async () => file }]);
    }
    return nativeOpenPicker.apply(window, args);
  };
}

const nativeShowPicker = HTMLInputElement.prototype.showPicker;
if (nativeShowPicker) {
  HTMLInputElement.prototype.showPicker = function (this: HTMLInputElement) {
    if (deliver(this)) return;
    return nativeShowPicker.call(this);
  };
}

export {};
