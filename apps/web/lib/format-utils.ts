export function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

export function formatPercentage(n: number): string {
  return `${n.toFixed(1)}%`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
