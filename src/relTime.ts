// Format a unix-seconds timestamp as a short, human-readable string relative
// to `now` (also unix seconds; defaults to the current time). Used by the
// bookmarks panel for "Last visit" / "Created" cells. Returns "never" for
// null. Anything older than 6 days drops the "X days ago" wording and falls
// back to a "Mon dd" calendar stamp.
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function relTime(unixSeconds: number | null, now: number = Math.floor(Date.now() / 1000)): string {
  if (unixSeconds == null) return "never";
  const diff = now - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m} min ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h}h ago`;
  }
  if (diff < 86400 * 2) return "yesterday";
  if (diff < 86400 * 7) {
    const d = Math.floor(diff / 86400);
    return `${d} days ago`;
  }
  const date = new Date(unixSeconds * 1000);
  return `${MONTHS[date.getMonth()]} ${date.getDate().toString().padStart(2, "0")}`;
}
