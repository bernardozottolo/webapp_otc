import { useEffect, useState } from "react";

export const QUOTE_REFRESH_INTERVAL_MS = 20_000;

const RING_RADIUS = 7;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface QuoteRefreshIndicatorProps {
  updatedAt?: string | null;
  loading: boolean;
}

export function QuoteRefreshIndicator({ updatedAt, loading }: QuoteRefreshIndicatorProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (loading || !updatedAt) {
      return;
    }

    const updatedAtMs = Date.parse(updatedAt);
    if (!Number.isFinite(updatedAtMs)) {
      return;
    }

    const updateProgress = () => {
      const elapsed = Date.now() - updatedAtMs;
      setProgress(Math.min(Math.max(elapsed / QUOTE_REFRESH_INTERVAL_MS, 0), 1));
    };

    updateProgress();
    const timerId = window.setInterval(updateProgress, 100);
    return () => window.clearInterval(timerId);
  }, [updatedAt, loading]);

  if (!loading && !updatedAt) {
    return null;
  }

  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);

  return (
    <span
      className={`quote-refresh-indicator${loading ? " quote-refresh-indicator--loading" : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 18 18" width="16" height="16">
        <circle className="quote-refresh-indicator__track" cx="9" cy="9" r={RING_RADIUS} />
        <circle
          className="quote-refresh-indicator__progress"
          cx="9"
          cy="9"
          r={RING_RADIUS}
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={loading ? RING_CIRCUMFERENCE * 0.75 : dashOffset}
          transform="rotate(-90 9 9)"
        />
      </svg>
    </span>
  );
}
