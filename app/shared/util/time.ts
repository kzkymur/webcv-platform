export function formatTimestamp(d: Date) {
  const p = (n: number, w = 2) => n.toString().padStart(w, "0");
  // Use second-level precision only (no milliseconds) for filenames
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
