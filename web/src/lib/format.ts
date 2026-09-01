export function centsToUSD(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatDuration(startMs: number, endMs: number | null): string {
  if (endMs === null) return 'running...';
  const seconds = Math.round((endMs - startMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function formatPnl(cents: number): string {
  const prefix = cents >= 0 ? '+' : '';
  return `${prefix}${centsToUSD(cents)}`;
}

export function formatQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(3).replace(/\.?0+$/, '');
}
