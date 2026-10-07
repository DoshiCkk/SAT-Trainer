import type { Attempt, ErrorReason, Session } from "../types";

/**
 * Attempt history. Keyed by question id so re-running the parser (which rewrites
 * questions.json) never disturbs it.
 */
const DB_NAME = "sat-train";
const DB_VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("attempts")) {
        const s = db.createObjectStore("attempts", { keyPath: "key" });
        s.createIndex("questionId", "questionId");
        s.createIndex("sessionId", "sessionId");
        s.createIndex("at", "at");
      }
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("marks")) {
        db.createObjectStore("marks", { keyPath: "questionId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export const listAttempts = () => tx<Attempt[]>("attempts", "readonly", (s) => s.getAll());
export const listSessions = () => tx<Session[]>("sessions", "readonly", (s) => s.getAll());

export async function putAttempts(rows: Attempt[]): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("attempts", "readwrite");
    const store = t.objectStore("attempts");
    for (const r of rows) store.put(r);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function setReason(key: string, reason: ErrorReason | undefined): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("attempts", "readwrite");
    const store = t.objectStore("attempts");
    const get = store.get(key);
    get.onsuccess = () => {
      const row = get.result as Attempt | undefined;
      if (row) {
        if (reason) row.reason = reason;
        else delete row.reason;
        store.put(row);
      }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export const putSession = (s: Session) => tx("sessions", "readwrite", (st) => st.put(s));

export async function listMarks(): Promise<string[]> {
  const rows = await tx<{ questionId: string }[]>("marks", "readonly", (s) => s.getAll());
  return rows.map((r) => r.questionId);
}

export async function setMark(questionId: string, marked: boolean): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("marks", "readwrite");
    const store = t.objectStore("marks");
    if (marked) store.put({ questionId, at: Date.now() });
    else store.delete(questionId);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function wipe(): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(["attempts", "sessions", "marks"], "readwrite");
    t.objectStore("attempts").clear();
    t.objectStore("sessions").clear();
    t.objectStore("marks").clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
