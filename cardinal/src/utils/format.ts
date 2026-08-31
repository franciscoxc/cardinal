// Format bytes into KB with one decimal place (legacy function)
export function formatKB(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes)) return null;
  const kb = bytes / 1024;
  return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
}

// Format timestamp (in seconds) as YYYY-MM-DD HH:mm:ss
export function formatTimestamp(timestampSec: number | null | undefined): string | null {
  if (timestampSec == null || !Number.isFinite(timestampSec)) return null;
  const date = new Date(timestampSec * 1000);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/// Bytes as a person reads them, picking the unit so the number stays short.
///
/// `formatKB` above always says KB, which turns 3.4 GB into "3565158 KB" — a number nobody can
/// weigh a decision against, and weighing a decision is the whole point where this is used.
export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unit]}`;
}
