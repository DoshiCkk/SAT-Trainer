import { useEffect } from "react";
import type { ReactNode } from "react";

/**
 * The reference sheet Bluebook shows in every Math module, drawn as vectors so
 * it stays sharp and reflows instead of being one fixed-size picture.
 */

function Fig({ label, children }: { label: string; children: ReactNode }) {
  return (
    <svg
      className="ref-fig"
      viewBox="0 0 120 78"
      role="img"
      aria-label={label}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {children}
    </svg>
  );
}

/** Stacked fraction — the one piece of maths typography the sheet needs. */
function Frac({ n, d }: { n: string; d: string }) {
  return (
    <span className="frac">
      <span>{n}</span>
      <span>{d}</span>
    </span>
  );
}

function Card({
  figure,
  caption,
  wide,
  children,
}: {
  figure: ReactNode;
  caption?: string;
  wide?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className={`ref-card ${wide ? "wide" : ""}`}>
      {figure}
      {caption && <div className="ref-cap">{caption}</div>}
      {children && <div className="ref-eq">{children}</div>}
    </li>
  );
}

export default function Reference({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    // The sheet is docked beside the question, the way Bluebook opens it, so it
    // never covers the text it is meant to be read next to.
    <div className="ref-panel" role="region" aria-label="Справочные формулы">
      <div className="ref-head">
        <span>Reference</span>
        <button className="btn ghost sm" onClick={onClose}>
          Закрыть
        </button>
      </div>

      <div className="ref-body">
        <ul className="ref-grid">
          <Card
            figure={
              <Fig label="Круг радиуса r">
                <circle cx="54" cy="38" r="27" />
                <circle cx="54" cy="38" r="2.4" fill="currentColor" />
                <line x1="54" y1="38" x2="81" y2="38" />
                <text x="63" y="34">r</text>
              </Fig>
            }
          >
            <i>A</i> = π<i>r</i>
            <sup>2</sup>
            <br />
            <i>C</i> = 2π<i>r</i>
          </Card>

          <Card
            figure={
              <Fig label="Прямоугольник со сторонами l и w">
                <rect x="20" y="24" width="78" height="38" />
                <text x="59" y="18" textAnchor="middle">
                  ℓ
                </text>
                <text x="103" y="47">w</text>
              </Fig>
            }
          >
            <i>A</i> = ℓ<i>w</i>
          </Card>

          <Card
            figure={
              <Fig label="Треугольник с основанием b и высотой h">
                <path d="M14 62 L104 62 L62 16 Z" />
                <line x1="62" y1="16" x2="62" y2="62" strokeDasharray="3 3" />
                <path d="M62 56 L68 56 L68 62" />
                <text x="66" y="40">h</text>
                <text x="58" y="74">b</text>
              </Fig>
            }
          >
            <i>A</i> = <Frac n="1" d="2" />
            <i>bh</i>
          </Card>

          <Card
            figure={
              <Fig label="Прямоугольный треугольник со сторонами a, b, c">
                <path d="M28 18 L28 60 L100 60 Z" />
                <path d="M28 54 L34 54 L34 60" />
                <text x="16" y="42">b</text>
                <text x="62" y="74">a</text>
                <text x="70" y="32">c</text>
              </Fig>
            }
          >
            <i>c</i>
            <sup>2</sup> = <i>a</i>
            <sup>2</sup> + <i>b</i>
            <sup>2</sup>
          </Card>

          <Card
            wide
            caption="Special Right Triangles"
            figure={
              <div className="ref-pair">
                <Fig label="Треугольник 30-60-90">
                  <path d="M12 56 L98 56 L98 18 Z" />
                  <path d="M92 56 L92 50 L98 50" />
                  <text x="34" y="54.5" fontSize="7.5">
                    30°
                  </text>
                  <text x="95" y="36" fontSize="7.5" textAnchor="end">
                    60°
                  </text>
                  <text x="40" y="32">2x</text>
                  <text x="102" y="42">x</text>
                  <text x="42" y="73">x√3</text>
                </Fig>
                <Fig label="Треугольник 45-45-90">
                  <path d="M26 18 L26 60 L92 60 Z" />
                  <path d="M26 54 L32 54 L32 60" />
                  <text x="36" y="38" fontSize="7.5" textAnchor="middle">
                    45°
                  </text>
                  <text x="69" y="56" fontSize="7.5" textAnchor="middle">
                    45°
                  </text>
                  <text x="15" y="42">s</text>
                  <text x="56" y="73">s</text>
                  <text x="70" y="30">s√2</text>
                </Fig>
              </div>
            }
          />

          <Card
            figure={
              <Fig label="Прямоугольный параллелепипед">
                <path d="M18 30 L76 30 L76 62 L18 62 Z" />
                <path d="M18 30 L34 16 L92 16 L76 30" />
                <path d="M76 62 L92 48 L92 16" />
                <text x="44" y="74" textAnchor="middle">
                  ℓ
                </text>
                <text x="86" y="61">w</text>
                <text x="98" y="38">h</text>
              </Fig>
            }
          >
            <i>V</i> = ℓ<i>wh</i>
          </Card>

          <Card
            figure={
              <Fig label="Цилиндр радиуса r и высоты h">
                <ellipse cx="54" cy="18" rx="26" ry="8" />
                <path d="M28 18 L28 58" />
                <path d="M80 18 L80 58" />
                <path d="M28 58 A26 8 0 0 0 80 58" />
                <circle cx="54" cy="18" r="2.2" fill="currentColor" />
                <line x1="54" y1="18" x2="78" y2="14" />
                <text x="62" y="11">r</text>
                <text x="86" y="42">h</text>
              </Fig>
            }
          >
            <i>V</i> = π<i>r</i>
            <sup>2</sup>
            <i>h</i>
          </Card>

          <Card
            figure={
              <Fig label="Шар радиуса r">
                <circle cx="54" cy="40" r="27" />
                <ellipse cx="54" cy="40" rx="27" ry="9" strokeDasharray="3 3" />
                <circle cx="54" cy="40" r="2.2" fill="currentColor" />
                <line x1="54" y1="40" x2="75" y2="28" />
                <text x="68" y="24">r</text>
              </Fig>
            }
          >
            <i>V</i> = <Frac n="4" d="3" />
            π<i>r</i>
            <sup>3</sup>
          </Card>

          <Card
            figure={
              <Fig label="Конус радиуса r и высоты h">
                <path d="M54 8 L26 58" />
                <path d="M54 8 L82 58" />
                <ellipse cx="54" cy="58" rx="28" ry="7.5" />
                <line x1="54" y1="8" x2="54" y2="58" strokeDasharray="3 3" />
                <line x1="54" y1="58" x2="82" y2="58" strokeDasharray="3 3" />
                <path d="M54 52 L60 52 L60 58" />
                <text x="58" y="38">h</text>
                <text x="68" y="50">r</text>
              </Fig>
            }
          >
            <i>V</i> = <Frac n="1" d="3" />
            π<i>r</i>
            <sup>2</sup>
            <i>h</i>
          </Card>

          <Card
            figure={
              <Fig label="Пирамида с прямоугольным основанием">
                <path d="M56 8 L18 52 L54 64 L94 52 Z" />
                <path d="M18 52 L58 42 L94 52" strokeDasharray="3 3" />
                <path d="M56 8 L58 42" strokeDasharray="3 3" />
                <line x1="56" y1="8" x2="56" y2="53" strokeDasharray="3 3" />
                <path d="M56 47 L62 47 L62 53" />
                <text x="60" y="34">h</text>
                <text x="24" y="70">ℓ</text>
                <text x="82" y="66">w</text>
              </Fig>
            }
          >
            <i>V</i> = <Frac n="1" d="3" />ℓ<i>wh</i>
          </Card>
        </ul>

        <ul className="ref-notes">
          <li>The number of degrees of arc in a circle is 360.</li>
          <li>The number of radians of arc in a circle is 2π.</li>
          <li>The sum of the measures in degrees of the angles of a triangle is 180.</li>
        </ul>
      </div>
    </div>
  );
}
