/**
 * Exam clock. The server's expires_at is authoritative. The browser keeps a
 * monotonic reading (performance.now) from the moment of the last server
 * sync, so changing the device clock cannot add or remove time.
 */
export type ClockSync = {
  expiresAtMs: number;    // server expires_at (epoch ms)
  serverNowMs: number;    // server now() at sync (epoch ms)
  monoAtSync: number;     // performance.now() when the sync response arrived
};

export function createSync(expiresAt: string, serverNow: string, monoNow: number): ClockSync {
  return { expiresAtMs: Date.parse(expiresAt), serverNowMs: Date.parse(serverNow), monoAtSync: monoNow };
}

/** Milliseconds left, derived only from server time + monotonic elapsed time. */
export function remainingMs(sync: ClockSync, monoNow: number): number {
  const serverNowEstimate = sync.serverNowMs + (monoNow - sync.monoAtSync);
  return Math.max(0, sync.expiresAtMs - serverNowEstimate);
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min ${s ? `${s} s` : ""}`.trim();
  return `${s} s`;
}

/** Warning level for the countdown: calm → 10 % left → 5 minutes left. */
export function clockLevel(ms: number, durationSeconds: number): "normal" | "warning" | "critical" {
  if (ms <= 5 * 60 * 1000) return "critical";
  if (ms <= durationSeconds * 1000 * 0.1) return "warning";
  return "normal";
}
