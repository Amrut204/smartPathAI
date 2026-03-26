const marks = new Map<string, number>();

export function startPerfMark(name: string) {
  if (typeof performance === "undefined") return;
  marks.set(name, performance.now());
}

export function finishPerfMark(name: string) {
  if (typeof performance === "undefined") return;
  const startedAt = marks.get(name);
  if (startedAt === undefined) return;
  const duration = performance.now() - startedAt;
  marks.delete(name);
  const isDev = Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV);
  if (isDev) {
    console.info(`[perf] ${name}: ${duration.toFixed(1)}ms`);
  }
}
