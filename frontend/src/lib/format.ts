// Formatting + date helpers. Dates travel as "YYYY-MM-DD" strings and are parsed
// as *local* dates so a calendar day never shifts because of time zones.

export const formatPrice = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(s: string, n: number): string {
  const d = parseISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export const todayISO = () => toISODate(new Date());

export function nightsBetween(a: string, b: string): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

export function formatShortDate(s: string): string {
  return parseISODate(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatLongDate(s: string): string {
  return parseISODate(s).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** "Nov 12 – 17" or "Nov 28 – Dec 2", the way Airbnb prints a stay. */
export function formatRange(a: string, b: string): string {
  const da = parseISODate(a);
  const db = parseISODate(b);
  const sameMonth = da.getMonth() === db.getMonth() && da.getFullYear() === db.getFullYear();
  const left = da.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const right = sameMonth ? String(db.getDate()) : db.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${left} – ${right}`;
}

export const plural = (n: number, word: string, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`;

export function yearsSince(iso: string): number {
  const years = (Date.now() - new Date(iso).getTime()) / (365.25 * 86_400_000);
  return Math.max(1, Math.floor(years));
}

/** Is the night starting on `day` covered by any booked range? (ranges are [check_in, check_out)) */
export function isNightBooked(day: string, ranges: { check_in: string; check_out: string }[]) {
  return ranges.some((r) => r.check_in <= day && day < r.check_out);
}

/** First booked check-in strictly after `start` — the latest possible checkout. */
export function nextBlockedDate(start: string, ranges: { check_in: string; check_out: string }[]): string | null {
  const later = ranges.filter((r) => r.check_in > start).map((r) => r.check_in).sort();
  return later[0] ?? null;
}

export function rangeIsFree(a: string, b: string, ranges: { check_in: string; check_out: string }[]) {
  return !ranges.some((r) => r.check_in < b && a < r.check_out);
}

// ---------- experience times ----------
// Slot times arrive as local ISO datetimes without a zone ("2026-10-08T18:00:00").

/** "6pm", "4:30pm" — the compact badge style used on experience cards. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return `${h}${m ? `:${String(m).padStart(2, "0")}` : ""}${d.getHours() < 12 ? "am" : "pm"}`;
}

/** "6:00 – 7:00 pm" or "11:00 am – 12:00 pm". */
export function formatTimeRange(a: string, b: string): string {
  const fmt = (d: Date) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}`;
  const da = new Date(a);
  const db = new Date(b);
  const ampm = (d: Date) => (d.getHours() < 12 ? "am" : "pm");
  return ampm(da) === ampm(db) ? `${fmt(da)} – ${fmt(db)} ${ampm(db)}` : `${fmt(da)} ${ampm(da)} – ${fmt(db)} ${ampm(db)}`;
}

/** "Today, 8 October" / "Tomorrow, 9 October" / "Saturday, 10 October". */
export function formatSlotDay(iso: string): string {
  const day = iso.slice(0, 10);
  const d = parseISODate(day);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  if (day === todayISO()) return `Today, ${date}`;
  if (day === addDays(todayISO(), 1)) return `Tomorrow, ${date}`;
  return `${d.toLocaleDateString("en-GB", { weekday: "long" })}, ${date}`;
}

/** Badge for a card: "4pm" if it's in a single-day row, otherwise "Fri · 10am". */
export function formatSlotBadge(iso: string, withDay: boolean): string {
  if (!withDay) return formatTime(iso);
  const day = iso.slice(0, 10);
  const label =
    day === todayISO() ? "Today" : day === addDays(todayISO(), 1) ? "Tomorrow" : parseISODate(day).toLocaleDateString("en-US", { weekday: "short" });
  return `${label} · ${formatTime(iso)}`;
}

/** 60 -> "1 hour", 90 -> "1.5 hours", 600 -> "10 hours", 45 -> "45 min". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Next Saturday and Sunday (this weekend if today is a weekend day). */
export function weekendRange(): [string, string] {
  const d = new Date();
  const dow = d.getDay(); // 0 Sun .. 6 Sat
  const toSat = dow === 0 ? -1 : 6 - dow;
  const sat = addDays(todayISO(), toSat);
  return [dow === 0 ? todayISO() : sat, addDays(sat, 1)];
}

/** Guest count from a URL param: junk like `?guests=abc` falls back instead of rendering "NaN guests". */
export function guestsParam(value: string | null, min = 1, max = 16): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

/** Dates from a URL, kept only if they form a bookable stay: well-formed, in order, not in the past. */
export function validStayParams(checkIn: string | null, checkOut: string | null): [string | null, string | null] {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!checkIn || !iso.test(checkIn) || Number.isNaN(parseISODate(checkIn).getTime()) || checkIn < todayISO()) return [null, null];
  if (!checkOut || !iso.test(checkOut) || checkOut <= checkIn) return [checkIn, null];
  return [checkIn, checkOut];
}
