/**
 * Client-side Trust & Safety guard for the message composer. Mirrors
 * backend/app/services/moderation.py, which stays the source of truth:
 *
 * - "blocked": digits (any script), plain emails or links. Send is disabled; the API
 *   would refuse them with 422 CONTACT_INFO_PROHIBITED anyway.
 * - "hidden": obfuscated attempts (spelled-out numbers, "name at gmail dot com", UPI ids,
 *   @handles, WhatsApp/Telegram/"call me"). Sending is allowed and the server replaces
 *   them with "[Hidden by Airbnb for safety]".
 */

export const SAFETY_WARNING =
  "To protect your payment and privacy, sharing phone numbers, digits, email addresses, or off-platform contact details is not allowed on Airbnb.";
export const PLACEHOLDER = "[Hidden by Airbnb for safety]";
export const MAX_MESSAGE_LENGTH = 1000;

export type GuardLevel = "ok" | "hidden" | "blocked";
export interface GuardResult {
  level: GuardLevel;
  reasons: string[];
}

const ZERO_WIDTH = /[­᠎​-‏‪-‮⁠-⁤﻿]/g;
const SEP = String.raw`[\s.\-–—_/\\|,:;()\[\]{}*+~'"]*`;

const NUMBER_WORDS = [
  "zero", "oh", "nil", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
  "twenty", "thirty", "forty", "fourty", "fifty", "sixty", "seventy", "eighty", "ninety",
  "hundred", "thousand", "lakh", "lac", "crore",
  "shunya", "ek", "do", "teen", "char", "chaar", "paanch", "panch", "chhe", "chhah", "che", "saat",
  "aath", "nau", "das",
];
const MULTIPLIERS = ["double", "triple", "dubble", "tripple"];
const WORD_ALT = [...NUMBER_WORDS, ...MULTIPLIERS].sort((a, b) => b.length - a.length).join("|");
const NUMBER_TOKEN = String.raw`(?:\d+|(?:${WORD_ALT}))`;
const NUMBER_RUN = new RegExp(String.raw`(?<![a-z])${NUMBER_TOKEN}(?:${SEP}(?:and${SEP})?${NUMBER_TOKEN})*(?![a-z])`, "gi");
const WORD_TOKEN = new RegExp(WORD_ALT, "gi");
const MULTIPLIER_TOKEN = new RegExp(String.raw`\b(?:${MULTIPLIERS.join("|")})\b`, "i");

const ANY_DIGIT = new RegExp(String.raw`\p{Nd}`, "u"); // any script: ０-９, ०-९, ٠-٩
const TLDS = ["com", "in", "net", "org", "io", "co", "me", "ly", "app", "info", "biz", "link", "xyz", "site"];
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/i;
// No "i" flag: a domain ending is all lower- or all upper-case, so "Hi.Me and my wife" isn't a link.
const URL_RE = new RegExp(
  String.raw`(?:[hH][tT][tT][pP][sS]?:\/\/|[wW][wW][wW]\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:${TLDS.flatMap((t) => [t, t.toUpperCase()]).join("|")})\b(?:\/\S*)?`,
);
// known TLD, and a literal "." must touch it, so "meet at noon. Thanks" stays a sentence
const OBFUSCATED_EMAIL = new RegExp(
  String.raw`[\w.+-]+${SEP}(?:@|\bat\b|\(at\)|\[at\])${SEP}[\w-]+(?:\s*\.|${SEP}(?:\bdot\b|\(dot\)|\[dot\])${SEP})(?:${TLDS.join("|")})\b`,
  "i",
);
const UPI_OR_HANDLE = /\b[\w.-]{2,}@[a-z]{2,}\b|(?<![\w@])@[\w.]{3,}/i;
const CONTACT_KEYWORDS = [
  "whatsapp", "watsapp", "whatsap", "telegram", "instagram", "insta", "snapchat",
  "facebook", "gmail", "paytm", "gpay", "googlepay", "phonepe", "venmo", "paypal",
  "callme", "textme", "dmme", "wame", "tme",
];
const spaced = (w: string) => w.split("").join(SEP);
const CONTACT_KEYWORD = new RegExp(
  String.raw`(?<![a-z])(?:${CONTACT_KEYWORDS.sort((a, b) => b.length - a.length).map(spaced).join("|")})(?![a-z])`,
  "i",
);

function spelledOutNumber(text: string): boolean {
  for (const m of text.matchAll(NUMBER_RUN)) {
    const words = m[0].match(WORD_TOKEN)?.length ?? 0;
    if (/\d/.test(m[0]) || words >= 3 || (MULTIPLIER_TOKEN.test(m[0]) && words >= 2)) return true;
  }
  return false;
}

export function checkMessage(raw: string): GuardResult {
  const text = raw.normalize("NFKC").replace(ZERO_WIDTH, "");
  const blocked: string[] = [];
  if (ANY_DIGIT.test(text)) blocked.push("numbers");
  if (EMAIL.test(text)) blocked.push("email addresses");
  if (URL_RE.test(text)) blocked.push("links");
  if (blocked.length) return { level: "blocked", reasons: blocked };

  const hidden: string[] = [];
  if (spelledOutNumber(text)) hidden.push("spelled-out numbers");
  if (OBFUSCATED_EMAIL.test(text)) hidden.push("email addresses");
  if (UPI_OR_HANDLE.test(text)) hidden.push("payment IDs or handles");
  if (CONTACT_KEYWORD.test(text)) hidden.push("off-platform apps");
  return hidden.length ? { level: "hidden", reasons: hidden } : { level: "ok", reasons: [] };
}
