import type { Question } from "../types";

/**
 * Talking to the service worker in public/sw.js.
 *
 * The worker caches the shell and whatever material the page happens to ask
 * for, which is enough for a reconnecting phone. A bus through a tunnel is not,
 * so the page can also hand it the full list of files up front.
 */

export interface OfflineReport {
  cached: number;
  total: number;
  failed: number;
  running: boolean;
}

/** Service workers need a secure origin; localhost counts as one. */
export function offlineSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && "caches" in window;
}

export function registerWorker(): void {
  if (!offlineSupported()) return;
  // In dev the worker would serve yesterday's bundle over Vite's own HMR.
  if (!import.meta.env.PROD) return;
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
    .catch(() => {
      // No offline mode then; the app itself still works online.
    });
}

/** Every file a module could reach for once the network is gone. */
export function offlineUrls(questions: Question[]): string[] {
  const base = import.meta.env.BASE_URL;
  const out = new Set<string>([`${base}questions.json`]);
  for (const q of questions) {
    for (const src of [q.image, q.choicesImage, q.rationaleImage]) {
      if (src) out.add(`${base}${src}`);
    }
    for (const src of Object.values(q.choiceImages ?? {})) {
      if (src) out.add(`${base}${src}`);
    }
  }
  return [...out];
}

type WorkerMessage =
  | { type: "precache-status"; cached: number; total: number }
  | { type: "precache-progress"; done: number; failed: number; total: number }
  | { type: "precache-done"; done: number; failed: number; total: number };

async function controller(): Promise<ServiceWorker | null> {
  if (!offlineSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.active ?? navigator.serviceWorker.controller;
}

/** Subscribe to the worker's reports. Returns an unsubscribe function. */
export function onWorkerMessage(fn: (msg: WorkerMessage) => void): () => void {
  if (!offlineSupported()) return () => {};
  const handler = (e: MessageEvent) => {
    const data = e.data as WorkerMessage | undefined;
    if (data && typeof data.type === "string" && data.type.startsWith("precache-")) fn(data);
  };
  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}

export async function askStatus(urls: string[]): Promise<void> {
  (await controller())?.postMessage({ type: "status", urls });
}

export async function startDownload(urls: string[]): Promise<void> {
  (await controller())?.postMessage({ type: "precache", urls });
}

export async function clearDownload(urls: string[]): Promise<void> {
  (await controller())?.postMessage({ type: "clear", urls });
}

export function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} МБ`;
}
