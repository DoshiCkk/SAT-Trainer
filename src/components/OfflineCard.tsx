import { useCallback, useEffect, useMemo, useState } from "react";
import type { Question, QuestionFile } from "../types";
import {
  askStatus,
  clearDownload,
  offlineSupported,
  offlineUrls,
  onWorkerMessage,
  startDownload,
} from "../lib/offline";

/**
 * Pulls the whole question base into the browser cache.
 *
 * The service worker already keeps whatever has been opened once, which covers
 * a phone that reconnects. This is for the case it cannot cover: a bus through
 * a tunnel, where a module has to start with no network at all.
 */
export default function OfflineCard({
  questions,
  counts,
}: {
  questions: Question[];
  counts: QuestionFile["counts"];
}) {
  const urls = useMemo(() => offlineUrls(questions), [questions]);
  const [cached, setCached] = useState<number | null>(null);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const [running, setRunning] = useState(false);
  // In dev there is no worker at all, so there is nothing honest to offer.
  const [hasWorker, setHasWorker] = useState(false);
  const supported = offlineSupported();

  useEffect(() => {
    if (!supported) return;
    let alive = true;
    void navigator.serviceWorker.ready
      .then(() => {
        if (alive) setHasWorker(true);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [supported]);

  useEffect(() => {
    if (!hasWorker || urls.length === 0) return;
    const off = onWorkerMessage((msg) => {
      if (msg.type === "precache-status") setCached(msg.cached);
      if (msg.type === "precache-progress") {
        setDone(msg.done);
        setFailed(msg.failed);
      }
      if (msg.type === "precache-done") {
        setRunning(false);
        setFailed(msg.failed);
        setCached(msg.total - msg.failed);
      }
    });
    void askStatus(urls);
    return off;
  }, [hasWorker, urls]);

  const download = useCallback(() => {
    setRunning(true);
    setDone(0);
    setFailed(0);
    void startDownload(urls);
  }, [urls]);

  const drop = useCallback(() => {
    void clearDownload(urls);
    setCached(0);
  }, [urls]);

  // Nothing useful to say in dev or in a private window with no worker.
  if (!hasWorker || urls.length === 0) return null;

  const size = counts.imageBytes ? `${Math.round(counts.imageBytes / 1048576)} МБ` : null;
  const ready = cached != null && cached >= urls.length - failed && cached > 0;
  const pct = running ? Math.round((done / urls.length) * 100) : 0;

  return (
    <div className="offline-card">
      <div className="row" style={{ gap: 8 }}>
        <strong style={{ fontSize: 13.5 }}>Офлайн</strong>
        {ready && !running && <span className="offline-dot" title="Всё скачано" />}
      </div>

      {running ? (
        <>
          <div className="small muted">
            Скачиваю {done} из {urls.length}
            {failed > 0 && ` · не вышло: ${failed}`}
          </div>
          <div className="offline-bar">
            <div className="offline-fill" style={{ width: `${pct}%` }} />
          </div>
        </>
      ) : ready ? (
        <>
          <div className="small muted">
            Вопросы и картинки сохранены — модуль запустится без интернета.
            {failed > 0 && ` Не скачалось файлов: ${failed}.`}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost sm" onClick={download}>
              Докачать
            </button>
            <button className="btn ghost sm" onClick={drop}>
              Удалить копию
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="small muted">
            Сохранить всю базу в браузере{size && ` (${size})`}, чтобы заниматься там, где
            сети нет. Desmos офлайн не работает — Reference работает.
          </div>
          <button className="btn sm" onClick={download}>
            Скачать для офлайна
          </button>
          {cached != null && cached > 0 && (
            <div className="small muted">
              Уже сохранено: {cached} из {urls.length}
            </div>
          )}
        </>
      )}
    </div>
  );
}
