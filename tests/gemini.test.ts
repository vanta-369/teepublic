// The Gemini path: the only route by which a design image leaves the device
// other than an explicit upload, and the one the Privacy Policy has to describe
// exactly right.
//
// Runs the real lib/gemini.ts and lib/aiSettings.ts over a recording fetch and
// a fake localStorage.

import test from "node:test";
import assert from "node:assert/strict";

interface Recorded {
  url: string;
  method: string;
  body: string;
}

const requests: Recorded[] = [];

(globalThis as { fetch: typeof fetch }).fetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  requests.push({
    url: String(input),
    method: init?.method ?? "GET",
    body: String(init?.body ?? ""),
  });
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  title: "Retro Cat Tee",
                  description: "A cat.",
                  primaryTag: "cat",
                  tags: ["cat", "retro"],
                  matureContent: false,
                }),
              },
            ],
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}) as typeof fetch;

// lib/aiSettings.ts is a thin localStorage wrapper; give it one.
const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

const { generateListing } = await import("../apps/dashboard/lib/gemini.ts");
const { getGeminiKey, setGeminiKey } = await import("../apps/dashboard/lib/aiSettings.ts");

const API_KEY = "AIzaTestKeyNotReal";
const IMAGE_B64 = "iVBORw0KGgoAAAANSUhEUg";

test.beforeEach(() => {
  requests.length = 0;
});

test("nothing is sent until an AI action is invoked", async () => {
  // Importing the module, reading settings and holding an image are all
  // inert: no request happens without a call.
  setGeminiKey(API_KEY);
  assert.equal(getGeminiKey(), API_KEY);
  assert.equal(requests.length, 0, "no request from settings alone");
});

test("an explicit generate sends the image and prompt straight to Google", async () => {
  const listing = await generateListing({
    apiKey: API_KEY,
    prompt: "retro 80s cats",
    imageBase64: IMAGE_B64,
    imageMime: "image/png",
  });

  assert.equal(listing.title, "Retro Cat Tee");
  assert.equal(requests.length, 1, "exactly one request per design");

  const req = requests[0];
  assert.equal(new URL(req.url).host, "generativelanguage.googleapis.com");
  assert.equal(req.method, "POST");

  const body = JSON.parse(req.body);
  const parts = body.contents[0].parts;
  assert.ok(parts.some((p: { text?: string }) => p.text?.includes("retro 80s cats")));
  assert.equal(parts.find((p: { inline_data?: unknown }) => p.inline_data).inline_data.data, IMAGE_B64);
});

test("the API key goes to Google and nowhere else, and never in the body", async () => {
  await generateListing({
    apiKey: API_KEY,
    prompt: "x",
    imageBase64: IMAGE_B64,
    imageMime: "image/png",
  });

  const req = requests[0];
  assert.equal(new URL(req.url).searchParams.get("key"), API_KEY);
  assert.ok(!req.body.includes(API_KEY), "the key is not in the request body");

  // And it is never sent anywhere that is not Google.
  for (const r of requests) {
    const host = new URL(r.url).host;
    if (r.url.includes(API_KEY) || r.body.includes(API_KEY)) {
      assert.equal(host, "generativelanguage.googleapis.com");
    }
  }
});

test("no Higgstee or Supabase host is contacted by the AI path", async () => {
  await generateListing({
    apiKey: API_KEY,
    prompt: "x",
    imageBase64: IMAGE_B64,
    imageMime: "image/png",
  });

  for (const r of requests) {
    const host = new URL(r.url).host;
    assert.ok(!host.includes("higgstee"), `AI path contacted ${host}`);
    assert.ok(!host.includes("supabase"), `AI path contacted ${host}`);
  }
});

test("generation refuses without a key, so an image cannot be sent by accident", async () => {
  await assert.rejects(
    () => generateListing({ apiKey: "", prompt: "x", imageBase64: IMAGE_B64, imageMime: "image/png" }),
    /API key is missing/,
  );
  await assert.rejects(
    () => generateListing({ apiKey: API_KEY, prompt: "x", imageBase64: "", imageMime: "image/png" }),
    /Image data missing/,
  );
  assert.equal(requests.length, 0, "no request was made");
});

test("the Gemini key is kept in local browser storage only", async () => {
  store.clear();
  setGeminiKey(API_KEY);

  // It lands in this browser's localStorage under a known key…
  assert.equal(store.get("teepublic.gemini.apiKey"), API_KEY);
  // …and storing it causes no network traffic at all.
  assert.equal(requests.length, 0);
});
