import { useCallback } from "react";

/**
 * A PNG the parser cut out of the PDF — a table, a graph or a formula that has
 * no text layer. Crops are rendered at 3x; showing them at ZOOM/3 keeps them
 * sharp while matching the surrounding text size, and max-width shrinks them
 * further when the pane is narrow.
 */
const RENDER_ZOOM = 3;
/** The export sets body text around 8pt, which reads too small on screen. */
const ZOOM = 1.6;

export function Crop({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const fit = useCallback((img: HTMLImageElement | null) => {
    if (img) img.style.width = `${(img.naturalWidth / RENDER_ZOOM) * ZOOM}px`;
  }, []);

  return (
    <img
      className={`crop ${className ?? ""}`}
      src={`${import.meta.env.BASE_URL}${src}`}
      alt={alt}
      onLoad={(e) => fit(e.currentTarget)}
      ref={(el) => {
        if (el?.complete) fit(el);
      }}
    />
  );
}
