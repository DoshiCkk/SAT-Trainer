/**
 * Passage/stem text from the parser: HTML-escaped except for the <u>, <sub> and
 * <sup> tags it restores from the PDF's geometry, with blank lines as paragraphs.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const paras = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  return (
    <div className={className}>
      {paras.map((p, i) => (
        <p key={i} dangerouslySetInnerHTML={{ __html: p }} />
      ))}
    </div>
  );
}
