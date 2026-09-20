// Enough of the chrome.* extension APIs to run the extension's real storage
// and queue code in Node: chrome.storage.local (with change events),
// chrome.runtime.sendMessage and chrome.storage.onChanged.
//
// Only the surface the modules under test actually touch is implemented. The
// backing object is exposed so a test can assert on, or seed, what the
// extension believes is on disk.

type Change = { oldValue?: unknown; newValue?: unknown };
type ChangeListener = (changes: Record<string, Change>, area: string) => void;

export interface FakeChrome {
  storage: {
    local: {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      getKeys(): Promise<string[]>;
    };
    onChanged: {
      addListener(fn: ChangeListener): void;
      removeListener(fn: ChangeListener): void;
    };
  };
  runtime: {
    sendMessage(msg: unknown): Promise<void>;
    lastError?: { message: string };
  };
}

/** Everything the fake extension has "on disk". Readable from tests. */
export const storageArea: Record<string, unknown> = {};

export function resetFakeChrome(): void {
  for (const k of Object.keys(storageArea)) delete storageArea[k];
}

const listeners = new Set<ChangeListener>();

function notify(changes: Record<string, Change>) {
  for (const l of [...listeners]) l(changes, "local");
}

export function installFakeChrome(): FakeChrome {
  const chrome: FakeChrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return { ...storageArea };
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) if (k in storageArea) out[k] = storageArea[k];
          return out;
        },
        async set(items) {
          const changes: Record<string, Change> = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: storageArea[k], newValue: v };
            storageArea[k] = v;
          }
          notify(changes);
        },
        async remove(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          const changes: Record<string, Change> = {};
          for (const k of list) {
            if (k in storageArea) {
              changes[k] = { oldValue: storageArea[k], newValue: undefined };
              delete storageArea[k];
            }
          }
          if (Object.keys(changes).length) notify(changes);
        },
        async getKeys() {
          return Object.keys(storageArea);
        },
      },
      onChanged: {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
      },
    },
    runtime: {
      async sendMessage() {
        /* no receiver in tests */
      },
    },
  };

  (globalThis as { chrome?: unknown }).chrome = chrome;
  return chrome;
}

/**
 * Seed a Supabase session so `auth.getUser()` has a token to present. The
 * expiry is far in the future so supabase-js does not try to refresh it, which
 * keeps the recorded traffic to exactly the calls under test.
 */
export function seedSupabaseSession(userId = "11111111-2222-3333-4444-555555555555"): void {
  storageArea["teepublic.auth"] = JSON.stringify({
    access_token: "fake-access-token",
    refresh_token: "fake-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId, aud: "authenticated", email: "seller@example.com" },
  });
}
