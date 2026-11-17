// Gemini API key + model selection, stored in localStorage. The user pastes
// once and the dashboard reuses it. Never transmitted anywhere except directly
// to generativelanguage.googleapis.com from the browser.

const KEY    = "teepublic.gemini.apiKey";
const MODEL  = "teepublic.gemini.model";
const PROMPT = "teepublic.gemini.prompt";

export function getGeminiKey(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(KEY) ?? "";
}

export function setGeminiKey(key: string): void {
  if (typeof window === "undefined") return;
  const trimmed = key.trim();
  if (trimmed) window.localStorage.setItem(KEY, trimmed);
  else        window.localStorage.removeItem(KEY);
}

export function getGeminiModel(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(MODEL) ?? "";
}

export function setGeminiModel(model: string): void {
  if (typeof window === "undefined") return;
  if (model) window.localStorage.setItem(MODEL, model);
  else       window.localStorage.removeItem(MODEL);
}

export function getGeminiPrompt(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(PROMPT) ?? "";
}

export function setGeminiPrompt(prompt: string): void {
  if (typeof window === "undefined") return;
  const trimmed = prompt.trim();
  if (trimmed) window.localStorage.setItem(PROMPT, trimmed);
  else        window.localStorage.removeItem(PROMPT);
}

// Which source "Generate with AI" uses: the API key above, or a Google account
// connected in the extension (lib/geminiAccount.ts), and which account.
const SOURCE  = "teepublic.gemini.source";
const ACCOUNT = "teepublic.gemini.accountIndex";

export type GeminiSource = "account" | "apiKey";

export function getGeminiSource(): GeminiSource {
  if (typeof window === "undefined") return "account";
  return window.localStorage.getItem(SOURCE) === "apiKey" ? "apiKey" : "account";
}

export function setGeminiSource(source: GeminiSource): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SOURCE, source);
}

export function getGeminiAccountIndex(): number | null {
  if (typeof window === "undefined") return null;
  const n = Number(window.localStorage.getItem(ACCOUNT));
  return window.localStorage.getItem(ACCOUNT) !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

export function setGeminiAccountIndex(index: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACCOUNT, String(index));
}
