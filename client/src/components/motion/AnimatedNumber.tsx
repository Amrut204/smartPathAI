import { useEffect, useRef, useState } from "react";

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

interface AnimatedNumberProps {
  value: number;
  durationMs?: number;
  cap?: number;
}

export function AnimatedNumber({ value, durationMs = 600, cap = 10000 }: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      setDisplayValue(value);
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion || hasAnimated.current || value >= cap || value < 0) {
      hasAnimated.current = true;
      setDisplayValue(value);
      return;
    }

    let frame = 0;
    const startedAt = window.performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const eased = easeOutCubic(progress);
      setDisplayValue(Math.round(value * eased));
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
        return;
      }
      hasAnimated.current = true;
      setDisplayValue(value);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [cap, durationMs, value]);

  return <>{displayValue}</>;
}
