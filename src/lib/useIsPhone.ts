import { useEffect, useState } from "react";

/** Mirrors the phone block in styles.css, where the layout stops being a desktop one. */
const PHONE = "(max-width: 560px)";

/**
 * True while the viewport is phone-sized.
 *
 * CSS handles the layout; this is only for the few labels that have to get
 * shorter — "Reading and Writing" costs three lines on a 390px screen.
 */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const sync = () => setPhone(mq.matches);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return phone;
}
