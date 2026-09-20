// A minimal in-memory IndexedDB, enough to run lib/localDb.ts unchanged.
//
// WHAT IT IS AND ISN'T. It implements the slice of the API the local store
// actually uses — open/upgrade, object stores with a keyPath, and
// get/getAll/getAllKeys/put/delete/clear inside a transaction — with the same
// request/event shape, so the code under test is the real code and not a
// re-implementation. It is NOT a conformance-grade IndexedDB: there are no
// indexes, no cursors, no key ranges, and transactions are not isolated from
// each other.
//
// Durability is modelled by keeping the data in a module-level map that
// survives `closeLocalDb()` and a fresh `indexedDB.open()`, which is what lets
// a test assert "the library is still there after the browser is closed and
// reopened". Restarting the Node process clears it, exactly as clearing site
// data would.

type Row = Record<string, unknown>;

interface StoreData {
  keyPath: string;
  rows: Map<string, Row>;
}

interface DbData {
  version: number;
  stores: Map<string, StoreData>;
}

/** The "disk". Survives close/reopen within one process. */
const disk = new Map<string, DbData>();

/** Wipe everything — the test equivalent of clearing site data. */
export function resetFakeStorage(): void {
  disk.clear();
}

/** How many rows a store holds, for assertions that bypass the app code. */
export function rawRowCount(dbName: string, store: string): number {
  return disk.get(dbName)?.stores.get(store)?.rows.size ?? 0;
}

/** The raw stored values, for asserting on what was persisted. */
export function rawRows(dbName: string, store: string): Row[] {
  return [...(disk.get(dbName)?.stores.get(store)?.rows.values() ?? [])];
}

function microtask(fn: () => void) {
  queueMicrotask(fn);
}

class FakeRequest<T> {
  result!: T;
  error: unknown = null;
  onsuccess: ((this: unknown, ev: unknown) => void) | null = null;
  onerror: ((this: unknown, ev: unknown) => void) | null = null;

  settle(value: T) {
    this.result = value;
    microtask(() => this.onsuccess?.call(this, { target: this }));
  }
  fail(err: unknown) {
    this.error = err;
    microtask(() => this.onerror?.call(this, { target: this }));
  }
}

class FakeObjectStore {
  constructor(
    private data: StoreData,
    private tx: FakeTransaction,
  ) {}

  private key(value: Row): string {
    const k = value[this.data.keyPath];
    if (k === undefined || k === null) throw new Error("missing key");
    return String(k);
  }

  put(value: Row) {
    const req = new FakeRequest<string>();
    this.tx.enqueue(() => {
      const k = this.key(value);
      this.data.rows.set(k, value);
      req.settle(k);
    });
    return req;
  }

  get(key: string) {
    const req = new FakeRequest<Row | undefined>();
    this.tx.enqueue(() => req.settle(this.data.rows.get(String(key))));
    return req;
  }

  getAll() {
    const req = new FakeRequest<Row[]>();
    this.tx.enqueue(() => req.settle([...this.data.rows.values()]));
    return req;
  }

  getAllKeys() {
    const req = new FakeRequest<string[]>();
    this.tx.enqueue(() => req.settle([...this.data.rows.keys()]));
    return req;
  }

  delete(key: string) {
    const req = new FakeRequest<undefined>();
    this.tx.enqueue(() => {
      this.data.rows.delete(String(key));
      req.settle(undefined);
    });
    return req;
  }

  clear() {
    const req = new FakeRequest<undefined>();
    this.tx.enqueue(() => {
      this.data.rows.clear();
      req.settle(undefined);
    });
    return req;
  }
}

class FakeTransaction {
  error: unknown = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  private pending: (() => void)[] = [];
  private scheduled = false;

  constructor(
    private db: FakeDatabase,
    private storeNames: string[],
  ) {}

  enqueue(fn: () => void) {
    this.pending.push(fn);
    if (!this.scheduled) {
      this.scheduled = true;
      // Run on a later turn, so all the synchronous calls a caller makes on
      // this transaction are collected first — that is what makes
      // idbReplaceAll's clear-then-put land in one shot, as in a real one.
      microtask(() => this.flush());
    }
  }

  private flush() {
    try {
      for (const fn of this.pending.splice(0)) fn();
      microtask(() => this.oncomplete?.());
    } catch (e) {
      this.error = e;
      microtask(() => this.onerror?.());
    }
  }

  objectStore(name: string) {
    if (!this.storeNames.includes(name)) throw new Error(`store ${name} not in transaction`);
    const data = this.db.data.stores.get(name);
    if (!data) throw new Error(`store ${name} does not exist`);
    return new FakeObjectStore(data, this);
  }
}

class FakeDatabase {
  onversionchange: (() => void) | null = null;
  closed = false;

  constructor(
    public name: string,
    public data: DbData,
  ) {}

  get objectStoreNames() {
    const names = [...this.data.stores.keys()];
    return { contains: (n: string) => names.includes(n), length: names.length };
  }

  createObjectStore(name: string, opts: { keyPath: string }) {
    this.data.stores.set(name, { keyPath: opts.keyPath, rows: new Map() });
    return { name };
  }

  transaction(storeNames: string | string[]) {
    if (this.closed) throw new Error("database is closed");
    return new FakeTransaction(this, Array.isArray(storeNames) ? storeNames : [storeNames]);
  }

  close() {
    this.closed = true;
  }
}

class FakeOpenRequest extends FakeRequest<FakeDatabase> {
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
}

/** Install the fake as the global `indexedDB`. Call once per test file. */
export function installFakeIndexedDb(): void {
  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open(name: string, version: number) {
      const req = new FakeOpenRequest();
      let data = disk.get(name);
      const isNew = !data;
      if (!data) {
        data = { version, stores: new Map() };
        disk.set(name, data);
      }
      const db = new FakeDatabase(name, data);
      microtask(() => {
        if (isNew || version > data!.version) {
          data!.version = version;
          req.result = db;
          req.onupgradeneeded?.();
        }
        req.settle(db);
      });
      return req;
    },
    deleteDatabase(name: string) {
      const req = new FakeRequest<undefined>();
      disk.delete(name);
      req.settle(undefined);
      return req;
    },
  };
}
