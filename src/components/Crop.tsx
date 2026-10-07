import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A PNG the parser cut out of the PDF — a table, a graph or a formula that has
 * no text layer. Crops are rendered at 3x; showing them at ZOOM/3 keeps them
 * sharp while matching the surrounding text size, and max-width shrinks them
 * further when the pane is narrow.
 */
const RENDER_ZOOM = 3;
/** The export sets body text around 8pt, which reads too small on screen. */
const ZOOM = 1.6;

function fitWidth(img: HTMLImageElement): number {
  return (img.naturalWidth / RENDER_ZOOM) * ZOOM;
}

export function Crop({
  src,
  alt,
  className,
  zoomable,
}: {
  src: string;
  alt: string;
  className?: string;
  /** Opens full size on tap. Left off inside a choice, which is a button already. */
  zoomable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const url = `${import.meta.env.BASE_URL}${src}`;

  const fit = useCallback((img: HTMLImageElement | null) => {
    if (img) img.style.width = `${fitWidth(img)}px`;
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const img = (
    <img
      className={`crop ${className ?? ""}`}
      src={url}
      alt={alt}
      onLoad={(e) => fit(e.currentTarget)}
      ref={(el) => {
        if (el?.complete) fit(el);
      }}
    />
  );

  if (!zoomable) return img;

  return (
    <>
      <button
        type="button"
        className="crop-btn"
        onClick={() => setOpen(true)}
        title="Открыть во весь экран"
        aria-label={`${alt} — открыть во весь экран`}
      >
        {img}
      </button>

      {open &&
        createPortal(
          // Squeezed into a phone column a crop drops to about half size, which
          // is below reading size for a formula; here it keeps its own width and
          // the overlay scrolls instead.
          <div
            className="crop-zoom"
            role="dialog"
            aria-label={alt}
            onClick={() => setOpen(false)}
          >
            <button className="btn sm crop-zoom-close" onClick={() => setOpen(false)}>
              Закрыть
            </button>
            <div className="crop-zoom-scroll" onClick={(e) => e.stopPropagation()}>
              <img
                src={url}
                alt={alt}
                onLoad={(e) => {
                  e.currentTarget.style.width = `${fitWidth(e.currentTarget)}px`;
                }}
              />
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
