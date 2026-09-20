// Gemini client — runs in the browser. The user pastes their API key in the
// UI; we never proxy it through a server. Calls
// generativelanguage.googleapis.com/v1beta with a vision-capable model and a
// responseSchema so the model returns JSON that maps cleanly to DesignMetadata.

// Gemini models that support image input. Newest first. The user picks in
// the UI; the default below is the one with the broadest free-tier coverage
// for batch image-to-listing generation.
export const GEMINI_MODELS: { id: string; label: string; note: string }[] = [
  // ── Latest 2.5 family ──────────────────────────────────────────────────
  { id: "gemini-2.5-flash-lite",  label: "Gemini 2.5 Flash Lite",  note: "Latest — free tier, fastest, recommended" },
  { id: "gemini-2.5-flash",       label: "Gemini 2.5 Flash",       note: "Latest — free tier limited, higher quality" },
  { id: "gemini-2.5-pro",         label: "Gemini 2.5 Pro",         note: "Latest — paid, most capable" },
  // ── 2.0 family (still supported) ───────────────────────────────────────
  { id: "gemini-2.0-flash-lite",  label: "Gemini 2.0 Flash Lite",  note: "Free tier" },
  { id: "gemini-2.0-flash",       label: "Gemini 2.0 Flash",       note: "Free tier in most regions" },
  // ── 1.5 family (legacy, kept for compatibility) ────────────────────────
  { id: "gemini-1.5-flash-latest",    label: "Gemini 1.5 Flash",    note: "Legacy free tier" },
  { id: "gemini-1.5-flash-8b-latest", label: "Gemini 1.5 Flash 8B", note: "Legacy free tier, smaller" },
];

export const DEFAULT_GEMINI_MODEL = GEMINI_MODELS[0].id;

function endpointFor(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

export interface GeneratedListing {
  title: string;
  description: string;
  primaryTag: string;
  tags: string[];
  matureContent: boolean;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title:         { type: "string", description: "TeePublic design title, 30-70 chars, marketable and specific." },
    description:   { type: "string", description: "2-3 sentence TeePublic description, customer-facing, no quotes." },
    primaryTag:    { type: "string", description: "Single most relevant primary tag (1-3 words)." },
    tags:          { type: "array", items: { type: "string" }, description: "Exactly 8 supporting tags, each 1-3 words, no '#'." },
    matureContent: { type: "boolean", description: "true only if the design depicts explicit content." },
  },
  required: ["title", "description", "primaryTag", "tags", "matureContent"],
} as const;

const SYSTEM_INSTRUCTION = [
  "You write TeePublic listings for print-on-demand designs.",
  "Output JSON matching the provided schema. No prose outside JSON.",
  "Be specific to what the image shows: subject, style, audience.",
  "Tags must be lowercase, no leading '#', 1-3 words each, no duplicates of the title's exact words.",
].join(" ");

export interface GenerateOptions {
  apiKey: string;
  prompt: string;
  imageBase64: string;
  imageMime: string;
  model?: string;
  signal?: AbortSignal;
}

/** Generate listing copy for a single design image. Throws on API failure. */
export async function generateListing(opts: GenerateOptions): Promise<GeneratedListing> {
  if (!opts.apiKey) throw new Error("Gemini API key is missing — paste it in the AI panel.");
  if (!opts.imageBase64) throw new Error("Image data missing.");
  const model = opts.model || DEFAULT_GEMINI_MODEL;

  const userPrompt = [
    "Create a TeePublic listing for the design in the attached image.",
    `Theme / direction from the user: ${opts.prompt.trim() || "(no extra theme — derive from the image)"}`,
    "Return JSON only.",
  ].join("\n");

  const body = {
    contents: [{
      role: "user",
      parts: [
        { text: userPrompt },
        { inline_data: { mime_type: opts.imageMime, data: opts.imageBase64 } },
      ],
    }],
    system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    generationConfig: {
      temperature: 0.8,
      response_mime_type: "application/json",
      response_schema: RESPONSE_SCHEMA,
    },
  };

  const res = await fetch(`${endpointFor(model)}?key=${encodeURIComponent(opts.apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Quota errors are the most common — surface a concise hint instead of the
    // raw 400-line JSON, so the user can act on it.
    if (res.status === 429) {
      throw new Error(`Gemini quota exceeded for ${model}. Try a different model in the API key panel (the free tier varies by region/account).`);
    }
    if (res.status === 403 || res.status === 401) {
      throw new Error(`Gemini ${res.status}: API key rejected. Double-check the key, or the model "${model}" may not be enabled for it.`);
    }
    const concise = (text.match(/"message":\s*"([^"]+)"/)?.[1] ?? text).slice(0, 240);
    throw new Error(`Gemini ${res.status} (${model}): ${concise || res.statusText}`);
  }

  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = json?.promptFeedback?.blockReason ?? "no candidate text";
    throw new Error(`Gemini returned no listing (${reason}).`);
  }

  let parsed: GeneratedListing;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Gemini response was not valid JSON: ${text.slice(0, 200)}`);
  }

  // Defensive normalization — the model occasionally returns slightly off shapes.
  return {
    title:         String(parsed.title ?? "").trim(),
    description:   String(parsed.description ?? "").trim(),
    primaryTag:    String(parsed.primaryTag ?? "").trim(),
    tags:          Array.isArray(parsed.tags) ? parsed.tags.map((t) => String(t).replace(/^#/, "").trim()).filter(Boolean) : [],
    matureContent: parsed.matureContent === true,
  };
}

/** Convert a File to its base64 body (no `data:...;base64,` prefix). */
export async function fileToBase64(file: File): Promise<string> {
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
}

function bytesToBase64(bytes: Uint8Array): string {
  // btoa handles 8-bit strings only; build one chunk-wise to avoid stack blow-up.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
