"use client";

import { useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";
import type { DesignMetadata, QueueBatch, QueueItem } from "@teepublic/shared";
import { SLUG_TO_PRODUCT_LABEL } from "@teepublic/shared";
import { Dropzone } from "./Dropzone";
import { sendQueueToExtension, getExtensionId } from "@/lib/bridge";
import { fileToBase64, urlToBase64, generateListing, GEMINI_MODELS, DEFAULT_GEMINI_MODEL, type GeneratedListing } from "@/lib/gemini";
import { loadDesigns, saveDesigns, type PersistedDesign } from "@/lib/designsStore";
import { uploadDesignImage } from "@/lib/uploadImage";
import { expandDroppedFiles } from "@/lib/zip";
import { getGeminiKey, setGeminiKey, getGeminiModel, setGeminiModel, getGeminiPrompt, setGeminiPrompt } from "@/lib/aiSettings";
import { assertCanGenerate, logGeneration, GenerationBlockedError } from "@/lib/access.client";
import type { ColorProductConfigValue } from "./ColorProductConfig";
import { allEnabledProducts, applyPreset, type ColorPreset } from "@/lib/colorPresets";
import { loadCustomBasicColors, saveCustomBasicColors, type CustomBasicColor } from "@/lib/batchConfig";
import { ColorsEditor } from "./ColorsEditor";
import { DesignPreview, DesignColorSwatches } from "./DesignPreview";

interface StagedImage {
  id: string;
  // Absent for designs rehydrated from the database (we only kept the URL).
  file?: File;
  url: string;
  serverFilename: string;
  originalName: string;
  mime: string;
  size: number;
  previewUrl: string;
  base64?: string;
}

// Get the raw base64 for a design image, whether it came from a fresh upload
// (has a File) or was rehydrated from the database (only the stored URL).
async function ensureBase64(img: StagedImage): Promise<string> {
  if (img.base64) return img.base64;
  const b64 = img.file ? await fileToBase64(img.file) : await urlToBase64(img.url);
  img.base64 = b64;
  return b64;
}

type DesignStatus = "idle" | "generating" | "ready" | "error";

interface GeneratedDesign {
  image: StagedImage;
  listing: GeneratedListing | null;
  status: DesignStatus;
  error?: string;
  // Every design carries its own colors/products config so changes never
  // bleed across designs in the batch.
  config: ColorProductConfigValue;
}

type SendStage = "idle" | "sending" | "sent";
type DesignTab = "info" | "colors" | "products";

function defaultDesignConfig(): ColorProductConfigValue {
  return {
    preset: "light",
    productColors: applyPreset("light"),
    enabledProducts: allEnabledProducts(),
  };
}

export function GenerationApp({ sessionId }: { sessionId: string }) {
  const [apiKey, setKey]   = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey]   = useState(false);
  const [model, setModel]       = useState<string>(DEFAULT_GEMINI_MODEL);

  const [images, setImages] = useState<StagedImage[]>([]);
  // `prompt` is the live draft (what's in the textarea). `savedPrompt`
  // mirrors what's in localStorage so we can show "Saved / Unsaved" and
  // gate the Save button. Loaded from localStorage on mount.
  const [prompt, setPrompt] = useState("");
  const [savedPrompt, setSavedPrompt] = useState("");
  const [designs, setDesigns] = useState<GeneratedDesign[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<SendStage>("idle");
  const abortRef = useRef<AbortController | null>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [tab, setTab] = useState<DesignTab>("info");

  // Custom basic colors — extend the swatch row, persisted across sessions.
  const [customBasicColors, setCustomBasicColors] = useState<CustomBasicColor[]>([]);

  // Becomes true once we've loaded the user's saved designs from the server,
  // so the autosave effect doesn't overwrite them with the empty initial state.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setKey(getGeminiKey());
    setKeyDraft(getGeminiKey());
    const savedModel = getGeminiModel();
    if (savedModel) setModel(savedModel);
    setCustomBasicColors(loadCustomBasicColors());
    const sp = getGeminiPrompt();
    setSavedPrompt(sp);
    setPrompt(sp);
  }, []);

  function savePrompt() {
    const next = prompt.trim();
    setGeminiPrompt(next);
    setSavedPrompt(next);
  }
  function clearSavedPrompt() {
    setGeminiPrompt("");
    setSavedPrompt("");
  }

  function handleModelChange(next: string) {
    setModel(next);
    setGeminiModel(next);
  }

  const savedOnce = useRef(false);
  useEffect(() => {
    if (!savedOnce.current) { savedOnce.current = true; return; }
    saveCustomBasicColors(customBasicColors);
  }, [customBasicColors]);

  // Load the user's saved designs once on mount so their work follows their
  // account across browsers/devices.
  useEffect(() => {
    (async () => {
      try {
        const saved = await loadDesigns();
        if (saved.length > 0) {
          const imgs: StagedImage[] = saved.map((d) => ({
            id: d.id,
            url: d.imageUrl,
            serverFilename: d.serverFilename,
            originalName: d.originalName,
            mime: d.mime,
            size: d.size,
            previewUrl: d.imageUrl, // no local blob; the stored URL renders fine
          }));
          const des: GeneratedDesign[] = saved.map((d) => {
            const image = imgs.find((i) => i.id === d.id)!;
            // "generating" is transient — never restore a stuck spinner.
            const status: DesignStatus =
              d.status === "generating" ? (d.listing ? "ready" : "idle") : (d.status as DesignStatus);
            return { image, listing: d.listing, status, config: d.config ?? defaultDesignConfig() };
          });
          setImages(imgs);
          setDesigns(des);
        }
      } catch (e) {
        console.warn("loadDesigns failed", e); // non-fatal: start empty
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // Keep `designs` in lockstep with `images`. New images become idle designs
  // with the default config; removed images drop their design row entirely.
  useEffect(() => {
    setDesigns((prev) => {
      const byId = new Map(prev.map((d) => [d.image.id, d]));
      return images.map((img) =>
        byId.get(img.id) ?? {
          image: img,
          listing: null,
          status: "idle" as DesignStatus,
          config: defaultDesignConfig(),
        }
      );
    });
  }, [images]);

  // Save the current batch to the user's account on demand (the Import button),
  // not automatically. saveDesigns is authoritative: it upserts these designs
  // and deletes any of the user's designs not in this set.
  const [importStage, setImportStage] = useState<"idle" | "saving" | "saved">("idle");
  async function importToAccount() {
    setError(null);
    setImportStage("saving");
    try {
      const payload: PersistedDesign[] = designs.map((d) => ({
        id: d.image.id,
        sessionId,
        imageUrl: d.image.url,
        serverFilename: d.image.serverFilename,
        originalName: d.image.originalName,
        mime: d.image.mime,
        size: d.image.size,
        listing: d.listing,
        config: d.config,
        status: d.status,
      }));
      await saveDesigns(payload);
      setImportStage("saved");
    } catch (e) {
      setError(`Save failed: ${(e as Error).message}`);
      setImportStage("idle");
    }
  }
  // Any edit invalidates the "saved" indicator.
  useEffect(() => { if (hydrated) setImportStage("idle"); }, [designs, hydrated]);

  useEffect(() => {
    if (currentIndex >= designs.length) setCurrentIndex(Math.max(0, designs.length - 1));
  }, [designs.length, currentIndex]);

  async function handleImages(rawFiles: File[]) {
    setError(null);
    // Expand any dropped .zip into its image files.
    const { images: files } = await expandDroppedFiles(rawFiles);
    if (files.length === 0) { setError("No PNG/JPG images found in the drop."); return; }
    const next: StagedImage[] = [];
    for (const file of files) {
      try {
        const up = await uploadDesignImage(sessionId, file);
        next.push({
          id: nanoid(10),
          file,
          url: up.url,
          serverFilename: up.originalName,
          originalName: up.originalName,
          mime: up.mime,
          size: up.size,
          previewUrl: URL.createObjectURL(file),
        });
      } catch (e) {
        setError(`Upload of ${file.name} failed: ${(e as Error).message}`);
      }
    }
    setImages((prev) => [...prev, ...next]);
  }

  function removeImage(id: string) {
    setImages((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
    // Removal is persisted on the next Import (saveDesigns deletes missing ids).
  }

  function saveKey() {
    setGeminiKey(keyDraft);
    setKey(keyDraft.trim());
  }

  async function generateAll() {
    setError(null);
    if (!apiKey) { setError("Save your Gemini API key first."); return; }
    if (images.length === 0) { setError("Add at least one design image."); return; }
    if (!prompt.trim()) { setError("Add a prompt describing the theme."); return; }

    // Live access gate BEFORE any Gemini request (fail closed if unreachable).
    try {
      await assertCanGenerate();
    } catch (e) {
      if (e instanceof GenerationBlockedError) { void logGeneration("denied", { status: e.status }); }
      setError((e as Error).message);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setCurrentIndex(0);

    // Reset each design's listing + status, KEEP its config so user-set colors
    // survive a re-generate.
    setDesigns((prev) => prev.map((d) => ({ ...d, listing: null, status: "generating" })));

    for (let i = 0; i < images.length; i++) {
      if (ac.signal.aborted) break;
      const img = images[i];
      try {
        // Re-check access between items — a trial can expire or an admin can
        // suspend mid-batch; catch it at the next item, never from a cache.
        await assertCanGenerate();
        const base64 = await ensureBase64(img);
        const listing = await generateListing({
          apiKey,
          prompt,
          imageBase64: base64,
          imageMime: img.mime,
          model,
          signal: ac.signal,
        });
        void logGeneration("success", { model, imageId: img.id });
        setDesigns((prev) => prev.map((d) =>
          d.image.id === img.id ? { ...d, listing, status: "ready" } : d
        ));
      } catch (e) {
        if (ac.signal.aborted) break;
        // Access revoked mid-batch: stop the whole run, don't keep hitting Gemini.
        if (e instanceof GenerationBlockedError) {
          void logGeneration("denied", { status: e.status, imageId: img.id });
          setError((e as Error).message);
          setDesigns((prev) => prev.map((d) =>
            d.status === "generating" ? { ...d, status: "error", error: (e as Error).message } : d
          ));
          break;
        }
        void logGeneration("failed", { model, imageId: img.id, message: (e as Error).message });
        setDesigns((prev) => prev.map((d) =>
          d.image.id === img.id ? { ...d, status: "error", error: (e as Error).message } : d
        ));
      }
    }

    setBusy(false);
  }

  function cancel() {
    abortRef.current?.abort();
    setBusy(false);
  }

  function updateDesign(id: string, patch: Partial<GeneratedListing>) {
    setDesigns((prev) => prev.map((d) =>
      d.image.id === id && d.listing
        ? { ...d, listing: { ...d.listing, ...patch } }
        : d
    ));
  }

  function updateDesignConfig(id: string, next: ColorProductConfigValue) {
    setDesigns((prev) => prev.map((d) =>
      d.image.id === id ? { ...d, config: next } : d
    ));
  }

  /** Copy the source design's color settings (productColors + preset) onto
   *  every OTHER design in the batch. Leaves each design's enabledProducts
   *  alone — products are applied separately so users can sync colors
   *  without forcing every design to share the same enabled set. */
  function applyColorsToAllDesigns(sourceId: string) {
    const src = designs.find((d) => d.image.id === sourceId);
    if (!src) return;
    setDesigns((prev) => prev.map((d) =>
      d.image.id === sourceId
        ? d
        : { ...d, config: { ...d.config, productColors: { ...src.config.productColors }, preset: src.config.preset } }
    ));
  }

  /** Copy the source design's enabled-products list onto every OTHER design
   *  in the batch. Colors are left alone. */
  function applyProductsToAllDesigns(sourceId: string) {
    const src = designs.find((d) => d.image.id === sourceId);
    if (!src) return;
    setDesigns((prev) => prev.map((d) =>
      d.image.id === sourceId
        ? d
        : { ...d, config: { ...d.config, enabledProducts: [...src.config.enabledProducts] } }
    ));
  }

  // Retry a single failed design — useful after switching the model in the
  // dropdown without wanting to burn quota on already-succeeded designs.
  async function retryDesign(id: string) {
    const target = designs.find((d) => d.image.id === id);
    if (!target) return;
    if (!apiKey || !prompt.trim()) {
      setError("Need a saved API key and a prompt to retry.");
      return;
    }
    setError(null);
    // Live access gate before the (single) Gemini request.
    try {
      await assertCanGenerate();
    } catch (e) {
      if (e instanceof GenerationBlockedError) { void logGeneration("denied", { status: e.status, imageId: id }); }
      setError((e as Error).message);
      setDesigns((prev) => prev.map((d) =>
        d.image.id === id ? { ...d, status: "error", error: (e as Error).message } : d
      ));
      return;
    }
    setDesigns((prev) => prev.map((d) =>
      d.image.id === id ? { ...d, status: "generating", error: undefined } : d
    ));
    try {
      const base64 = await ensureBase64(target.image);
      const listing = await generateListing({
        apiKey,
        prompt,
        imageBase64: base64,
        imageMime: target.image.mime,
        model,
      });
      void logGeneration("success", { model, imageId: id });
      setDesigns((prev) => prev.map((d) =>
        d.image.id === id ? { ...d, listing, status: "ready" } : d
      ));
    } catch (e) {
      void logGeneration("failed", { model, imageId: id, message: (e as Error).message });
      setDesigns((prev) => prev.map((d) =>
        d.image.id === id ? { ...d, status: "error", error: (e as Error).message } : d
      ));
    }
  }

  function addCustomBasicColor(c: CustomBasicColor) {
    if (!c.name.trim()) return;
    if (customBasicColors.some((x) => x.name.toLowerCase() === c.name.toLowerCase())) return;
    setCustomBasicColors((prev) => [...prev, { name: c.name.trim(), hex: c.hex }]);
  }
  function removeCustomBasicColor(name: string) {
    setCustomBasicColors((prev) => prev.filter((c) => c.name.toLowerCase() !== name.toLowerCase()));
  }

  const readyCount = designs.filter((d) => d.status === "ready" && d.listing).length;
  const safeIndex = Math.min(currentIndex, Math.max(0, designs.length - 1));
  const currentDesign = designs[safeIndex];

  async function sendToQueue() {
    setError(null);
    const extId = getExtensionId();
    if (!extId) { setError("Set the extension ID in the panel above first."); return; }
    if (readyCount === 0) { setError("Generate at least one listing first."); return; }
    setStage("sending");
    try {
      const now = Date.now();
      const items: QueueItem[] = designs
        .filter((d) => d.status === "ready" && d.listing)
        .map((d): QueueItem => {
          const m: DesignMetadata = {
            filename:        d.image.serverFilename,
            title:           d.listing!.title,
            description:     d.listing!.description,
            primaryTag:      d.listing!.primaryTag || undefined,
            tags:            d.listing!.tags,
            matureContent:   d.listing!.matureContent,
            productColors:   { ...d.config.productColors },
            enabledProducts: [...d.config.enabledProducts],
          };
          return {
            id: nanoid(10),
            metadata: m,
            imageUrl: d.image.url,
            imageMime: d.image.mime,
            imageSizeBytes: d.image.size,
            status: "pending",
            selected: true,
            attempts: 0,
            createdAt: now,
            updatedAt: now,
          };
        });

      const batch: QueueBatch = {
        id: nanoid(12),
        createdAt: now,
        items,
        source: {
          spreadsheetName: `AI-generated (${items.length})`,
          rowCount: items.length,
          matchedCount: items.length,
        },
      };

      // Chunked send so large local images don't exceed Chrome's 64 MiB limit.
      await sendQueueToExtension(batch, extId);
      setStage("sent");
    } catch (e) {
      setError((e as Error).message);
      setStage("idle");
    }
  }

  return (
    <div className="space-y-6">
      {/* Gemini API key */}
      <section className="surface p-5 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Gemini API key</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Get a free key at{" "}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="underline">
                aistudio.google.com/apikey
              </a>. Stored only in this browser&apos;s localStorage.
            </p>
          </div>
          {apiKey ? <span className="chip-ok">Saved</span> : <span className="chip-warn">Not set</span>}
        </div>
        <div className="flex items-center gap-2">
          <input
            type={showKey ? "text" : "password"}
            className="input font-mono"
            placeholder="AIza..."
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <button type="button" className="btn-ghost" onClick={() => setShowKey((v) => !v)}>
            {showKey ? "Hide" : "Show"}
          </button>
          <button type="button" className="btn-primary" onClick={saveKey} disabled={keyDraft.trim() === apiKey}>
            Save
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap pt-1">
          <label className="text-xs text-zinc-500 dark:text-zinc-400">Model:</label>
          <select
            className="input max-w-xs"
            value={model}
            onChange={(e) => handleModelChange(e.target.value)}
          >
            {GEMINI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label} — {m.note}</option>
            ))}
          </select>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            If you hit a 429 quota error, switch to a different free-tier model here.
          </span>
        </div>
      </section>

      {/* Images */}
      <Dropzone
        title="Design images"
        hint="Drop .png/.jpg files or a .zip folder of designs. Each image becomes one TeePublic listing."
        accept="image/png,image/jpeg,image/webp,.zip,application/zip"
        multiple
        onFiles={handleImages}
        badge={images.length > 0 ? `${images.length} images staged` : undefined}
      />

      {/* Prompt + generate */}
      <section className="surface p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Prompt</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Describe the theme. Gemini sees each image and your prompt to craft a unique listing per design. Saved in this browser&apos;s localStorage.
            </p>
          </div>
          {savedPrompt
            ? (prompt.trim() === savedPrompt
                ? <span className="chip-ok">Saved</span>
                : <span className="chip-warn">Unsaved changes</span>)
            : <span className="chip-mute">Not saved</span>}
        </div>
        <textarea
          className="input min-h-[88px] resize-y"
          placeholder="e.g. Hawaii men&apos;s volleyball national champions — bold sporty tropical t-shirts, fan pride, game-day apparel"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={savePrompt}
            disabled={prompt.trim() === savedPrompt}
            title="Save the prompt to this browser so it auto-fills next time"
          >
            Save prompt
          </button>
          {savedPrompt && (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={clearSavedPrompt}
              title="Forget the saved prompt"
            >
              Clear saved
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {busy ? (
            <button type="button" className="btn-danger" onClick={cancel}>Cancel</button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={generateAll}
              disabled={images.length === 0 || !apiKey || !prompt.trim()}
            >
              {readyCount > 0 ? "Re-generate all" : `Generate ${images.length || ""} listings`}
            </button>
          )}
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {busy
              ? "Calling Gemini per image…"
              : readyCount > 0
                ? `${readyCount} of ${designs.length} ready`
                : "Ready when you are."}
          </span>
        </div>
      </section>

      {/* Pager + per-design configuration card */}
      {currentDesign && (
        <section className="space-y-3">
          <DesignPager
            current={safeIndex}
            total={designs.length}
            onPrev={() => setCurrentIndex(Math.max(0, safeIndex - 1))}
            onNext={() => setCurrentIndex(Math.min(designs.length - 1, safeIndex + 1))}
            onJump={(i) => setCurrentIndex(Math.max(0, Math.min(designs.length - 1, i)))}
          />
          <DesignConfigCard
            design={currentDesign}
            tab={tab}
            onTabChange={setTab}
            customBasicColors={customBasicColors}
            onAddCustomBasicColor={addCustomBasicColor}
            onRemoveCustomBasicColor={removeCustomBasicColor}
            onChangeListing={(patch) => updateDesign(currentDesign.image.id, patch)}
            onChangeConfig={(next) => updateDesignConfig(currentDesign.image.id, next)}
            onRemove={() => removeImage(currentDesign.image.id)}
            onRetry={() => retryDesign(currentDesign.image.id)}
            totalDesigns={designs.length}
            onApplyColorsToAll={() => applyColorsToAllDesigns(currentDesign.image.id)}
            onApplyProductsToAll={() => applyProductsToAllDesigns(currentDesign.image.id)}
          />
        </section>
      )}

      {error && <div className="surface p-4 text-danger-600 dark:text-danger-500">{error}</div>}

      {/* Send to extension */}
      <div className="surface p-5 flex items-center justify-between gap-6">
        <div>
          <div className="label">Ready to send</div>
          <div className="text-2xl font-semibold">
            <span className="font-mono text-accent-700 dark:text-accent-200">{readyCount}</span>
            <span className="text-zinc-500 dark:text-zinc-400 text-base"> / {designs.length} designs</span>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Each design ships with its own colors &amp; products configuration.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn-ghost text-base px-6 py-3"
            disabled={designs.length === 0 || importStage === "saving"}
            onClick={importToAccount}
          >
            {importStage === "saving" ? "Importing…" : importStage === "saved" ? "Imported ✓" : `Import (${designs.length})`}
          </button>
          <button
            type="button"
            className="btn-primary text-base px-6 py-3"
            disabled={readyCount === 0 || stage === "sending"}
            onClick={sendToQueue}
          >
            {stage === "sending" ? "Sending…" : stage === "sent" ? "Sent ✓" : `Send to extension (${readyCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DesignPager ────────────────────────────────────────────────────────────
function DesignPager({
  current, total, onPrev, onNext, onJump,
}: {
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onJump: (i: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const display = current + 1;

  return (
    <div className="surface px-4 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <button className="btn-ghost px-3 py-1.5 text-base" onClick={onPrev} disabled={current === 0} aria-label="Previous design">‹</button>
        <button className="btn-ghost px-3 py-1.5 text-base" onClick={onNext} disabled={current >= total - 1} aria-label="Next design">›</button>
        <span className="text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">Design </span>
          <span className="font-mono text-accent-700 dark:text-accent-200">{display}</span>
          <span className="text-zinc-500 dark:text-zinc-400"> of </span>
          <span className="font-mono">{total}</span>
        </span>
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = parseInt(draft, 10);
          if (!Number.isNaN(n)) onJump(n - 1);
          setDraft("");
        }}
      >
        <input
          className="surface-soft px-2 py-1 text-sm w-20 outline-none focus:border-accent-500/60 font-mono"
          placeholder="Jump to…"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
        />
      </form>
    </div>
  );
}

// ─── DesignConfigCard ──────────────────────────────────────────────────────
function DesignConfigCard({
  design,
  tab,
  onTabChange,
  customBasicColors,
  onAddCustomBasicColor,
  onRemoveCustomBasicColor,
  onChangeListing,
  onChangeConfig,
  onRemove,
  onRetry,
  totalDesigns,
  onApplyColorsToAll,
  onApplyProductsToAll,
}: {
  design: GeneratedDesign;
  tab: DesignTab;
  onTabChange: (t: DesignTab) => void;
  customBasicColors: CustomBasicColor[];
  onAddCustomBasicColor: (c: CustomBasicColor) => void;
  onRemoveCustomBasicColor: (name: string) => void;
  onChangeListing: (patch: Partial<GeneratedListing>) => void;
  onChangeConfig: (next: ColorProductConfigValue) => void;
  onRemove: () => void;
  onRetry: () => void;
  totalDesigns: number;
  onApplyColorsToAll: () => void;
  onApplyProductsToAll: () => void;
}) {
  const { image, listing, status, error } = design;

  return (
    <section className="surface p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-semibold tracking-tight">Design Configuration</h2>
        <div className="flex items-center gap-2">
          {status === "generating" && <span className="chip-info">Generating…</span>}
          {status === "ready"      && <span className="chip-ok">Ready</span>}
          {status === "error"      && <span className="chip-err">Failed</span>}
          {status === "idle"       && <span className="chip-mute">Pending</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        <div className="relative">
          <DesignPreview src={image.previewUrl} alt={image.serverFilename} productColors={design.config.productColors} />
          <button
            type="button"
            onClick={onRemove}
            className="absolute top-2 right-2 h-7 w-7 rounded-full bg-danger-500 text-white grid place-items-center shadow-md hover:bg-danger-600 transition"
            aria-label="Remove design"
          >×</button>
          <div className="mt-2 truncate text-xs text-zinc-500 dark:text-zinc-400" title={image.serverFilename}>
            {image.serverFilename}
          </div>
          <DesignColorSwatches productColors={design.config.productColors} />
        </div>

        <div className="space-y-4">
          <Tabs value={tab} onChange={onTabChange} />

          {tab === "info" && (
            listing ? <InfoTab listing={listing} onChange={onChangeListing} />
                    : <PlaceholderTab status={status} error={error} onRetry={onRetry} />
          )}
          {tab === "colors" && (
            <ColorsTab
              config={design.config}
              onChange={onChangeConfig}
              customBasicColors={customBasicColors}
              onAddCustomBasicColor={onAddCustomBasicColor}
              onRemoveCustomBasicColor={onRemoveCustomBasicColor}
              totalDesigns={totalDesigns}
              onApplyToAll={onApplyColorsToAll}
            />
          )}
          {tab === "products" && (
            <ProductsTab
              config={design.config}
              onChange={onChangeConfig}
              totalDesigns={totalDesigns}
              onApplyToAll={onApplyProductsToAll}
            />
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────────────
function Tabs({ value, onChange }: { value: DesignTab; onChange: (v: DesignTab) => void }) {
  const items: { id: DesignTab; label: string }[] = [
    { id: "info",     label: "Info" },
    { id: "colors",   label: "Colors" },
    { id: "products", label: "Products" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 p-1 rounded-xl bg-zinc-100 dark:bg-ink-800">
      {items.map((it) => {
        const active = value === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            className={`py-2.5 rounded-lg text-sm font-medium transition ${
              active
                ? "bg-white text-zinc-900 ring-1 ring-success-500/60 shadow-sm dark:bg-ink-900 dark:text-white"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            }`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Info tab ───────────────────────────────────────────────────────────────
function InfoTab({
  listing,
  onChange,
}: {
  listing: GeneratedListing;
  onChange: (patch: Partial<GeneratedListing>) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Design Title">
        <input className="input" value={listing.title} onChange={(e) => onChange({ title: e.target.value })} />
      </Field>
      <Field label="Primary Tag">
        <input className="input" value={listing.primaryTag} onChange={(e) => onChange({ primaryTag: e.target.value })} />
      </Field>
      <Field label="Description">
        <textarea className="input min-h-[88px] resize-y" value={listing.description} onChange={(e) => onChange({ description: e.target.value })} />
      </Field>
      <Field label="Supporting Tags">
        <textarea
          className="input min-h-[88px] resize-y"
          value={listing.tags.join(", ")}
          onChange={(e) => onChange({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
        />
      </Field>
      <div className="md:col-span-2">
        <div className="label mb-2">Adult Content</div>
        <YesNo value={listing.matureContent} onChange={(v) => onChange({ matureContent: v })} />
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
          Select &quot;Yes&quot; if this design contains adult content
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-semibold">{label}</span>
      {children}
    </label>
  );
}

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-6">
      {[
        { label: "No",  v: false },
        { label: "Yes", v: true  },
      ].map((opt) => {
        const active = value === opt.v;
        return (
          <button key={opt.label} type="button" onClick={() => onChange(opt.v)} className="flex items-center gap-2">
            <span className={`h-6 w-6 rounded-full grid place-items-center transition ${
              active ? "border-2 border-success-500 text-success-500"
                     : "border-2 border-zinc-300 dark:border-zinc-600 text-transparent"
            }`}>✓</span>
            <span className="text-sm font-medium">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Colors tab — per design ───────────────────────────────────────────────
function ColorsTab({
  config, onChange, customBasicColors, onAddCustomBasicColor, onRemoveCustomBasicColor,
  totalDesigns, onApplyToAll,
}: {
  config: ColorProductConfigValue;
  onChange: (next: ColorProductConfigValue) => void;
  customBasicColors: CustomBasicColor[];
  onAddCustomBasicColor: (c: CustomBasicColor) => void;
  onRemoveCustomBasicColor: (name: string) => void;
  totalDesigns: number;
  onApplyToAll: () => void;
}) {
  return (
    <ColorsEditor
      productColors={config.productColors}
      enabledProducts={config.enabledProducts}
      preset={config.preset}
      onChange={({ productColors, preset }) => onChange({ ...config, productColors, preset })}
      customBasicColors={customBasicColors}
      onAddCustomBasicColor={onAddCustomBasicColor}
      onRemoveCustomBasicColor={onRemoveCustomBasicColor}
      onApplyToAll={onApplyToAll}
      applyToAllCount={totalDesigns}
    />
  );
}

// ─── Products tab — per design ─────────────────────────────────────────────
function ProductsTab({
  config, onChange, totalDesigns, onApplyToAll,
}: {
  config: ColorProductConfigValue;
  onChange: (next: ColorProductConfigValue) => void;
  totalDesigns: number;
  onApplyToAll: () => void;
}) {
  function toggleProduct(label: string) {
    const has = config.enabledProducts.includes(label);
    onChange({
      ...config,
      enabledProducts: has
        ? config.enabledProducts.filter((p) => p !== label)
        : [...config.enabledProducts, label],
    });
  }
  function setAllProducts(enabled: boolean) {
    onChange({
      ...config,
      enabledProducts: enabled ? Object.values(SLUG_TO_PRODUCT_LABEL) : [],
    });
  }

  const canApplyToAll = totalDesigns > 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Applies to <span className="font-medium text-zinc-700 dark:text-zinc-200">this design only</span>. {config.enabledProducts.length} of {Object.keys(SLUG_TO_PRODUCT_LABEL).length} enabled.
        </p>
        <div className="flex items-center gap-2">
          {canApplyToAll && (
            <button
              type="button"
              className="btn-ghost text-xs px-2.5 py-1.5"
              title="Copy this design's enabled products onto every other design in the batch"
              onClick={() => {
                if (window.confirm(`Copy these enabled products to all ${totalDesigns} designs? This overwrites every other design's product list.`)) {
                  onApplyToAll();
                }
              }}
            >
              Apply to all {totalDesigns}
            </button>
          )}
          <button type="button" className="btn-ghost text-xs px-2.5 py-1.5" onClick={() => setAllProducts(true)}>All on</button>
          <button type="button" className="btn-ghost text-xs px-2.5 py-1.5" onClick={() => setAllProducts(false)}>All off</button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {Object.entries(SLUG_TO_PRODUCT_LABEL).map(([slug, label]) => {
          const on = config.enabledProducts.includes(label);
          return (
            <button
              key={slug}
              type="button"
              onClick={() => toggleProduct(label)}
              className={`surface-soft p-3 flex items-center justify-between text-left transition ${
                on ? "ring-1 ring-accent-500/40" : ""
              }`}
            >
              <span className="text-sm font-medium">{label}</span>
              <span className="switch" data-on={on} aria-hidden />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Placeholder (no listing yet) ──────────────────────────────────────────
function PlaceholderTab({
  status, error, onRetry,
}: {
  status: DesignStatus;
  error?: string;
  onRetry: () => void;
}) {
  if (status === "generating") {
    return <div className="surface-soft p-6 text-center text-sm text-zinc-500 dark:text-zinc-400">Generating with Gemini…</div>;
  }
  if (status === "error") {
    return (
      <div className="surface-soft p-6 text-center space-y-3">
        <p className="text-sm text-danger-600 dark:text-danger-500">{error ?? "Generation failed."}</p>
        <button type="button" className="btn-primary text-sm" onClick={onRetry}>Retry this design</button>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Tip: change the model in the API key panel first if you hit a quota error.
        </p>
      </div>
    );
  }
  return <div className="surface-soft p-6 text-center text-sm text-zinc-500 dark:text-zinc-400">Click &quot;Generate&quot; to populate this design.</div>;
}
