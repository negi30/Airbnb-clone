"""Trust & Safety filter for guest <-> host messages.

Keeps bookings and payments on the platform by refusing phone numbers, digits and
off-platform contact details. Two tiers:

* **Obvious** (plain ASCII digits, a normal email address, a URL): the client already
  blocks these as the user types, so receiving one means the client was bypassed.
  `sanitize_and_validate_message` rejects it with `ContactInfoProhibited` (HTTP 422).
* **Obfuscated** (Unicode digits, zero-width tricks, "9 . 8 . 7", "nine eight seven",
  "double nine", "name at gmail dot com", UPI ids, @handles, "whatsapp me"): redacted
  in place with `PLACEHOLDER` and the message carries a moderation warning that both
  sides see in the thread.

Detection runs on a normalized copy (NFKC, zero-width stripped, every Unicode decimal
digit mapped to ASCII). Normalization keeps one character per character apart from
NFKC expansions, so spans found on it are applied to that same normalized text, which
is what gets stored.
"""
import re
import unicodedata
from dataclasses import dataclass, field

PLACEHOLDER = "[Hidden by Airbnb for safety]"
WARNING = "Reminder: Keep all communication and payments on Airbnb. Numbers and contact details were hidden."
BLOCKED_CODE = "CONTACT_INFO_PROHIBITED"
BLOCKED_MESSAGE = "Numbers and contact details cannot be shared in messages."
MAX_LENGTH = 1000

ZERO_WIDTH = re.compile("[­᠎​-‏‪-‮⁠-⁤﻿]")

# Separators people put between characters to dodge filters: "9.8.7", "9 - 8", "w_h_a_t_s"
SEP = r"[\s.\-–—_/\\|,:;()\[\]{}*+~'\"]*"

NUMBER_WORDS = [
    # English
    "zero", "oh", "nil", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
    "twenty", "thirty", "forty", "fourty", "fifty", "sixty", "seventy", "eighty", "ninety",
    "hundred", "thousand", "lakh", "lac", "crore",
    # Hinglish
    "shunya", "ek", "do", "teen", "char", "chaar", "paanch", "panch", "chhe", "chhah", "che", "saat",
    "aath", "nau", "das",
]
MULTIPLIERS = ["double", "triple", "dubble", "tripple"]
_word_alt = "|".join(sorted(NUMBER_WORDS + MULTIPLIERS, key=len, reverse=True))
NUMBER_TOKEN = rf"(?:\d+|(?:{_word_alt}))"
# A run of number tokens: "nine eight 7 six", "double nine", "ek do teen"
NUMBER_RUN = re.compile(rf"(?<![a-z]){NUMBER_TOKEN}(?:{SEP}(?:and{SEP})?{NUMBER_TOKEN})*(?![a-z])", re.IGNORECASE)
WORD_TOKEN = re.compile(_word_alt, re.IGNORECASE)  # no \b: "ninenineeight" is three words
MULTIPLIER_TOKEN = re.compile(rf"\b(?:{'|'.join(MULTIPLIERS)})\b", re.IGNORECASE)
# Any digit, including digits split by separators ("9 . 8 . 7" is one span)
DIGIT_RUN = re.compile(rf"\d(?:{SEP}\d)*")

TLDS = ["com", "in", "net", "org", "io", "co", "me", "ly", "app", "info", "biz", "link", "xyz", "site"]
# A domain ending is all lower- or all upper-case: "Hi.Me and my wife" or "arrived.In the" are
# sentences typed without a space, not links.
_TLD = "(?-i:" + "|".join(t for tld in TLDS for t in (tld, tld.upper())) + ")"

EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", re.IGNORECASE)
URL = re.compile(rf"(?:https?://|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.{_TLD}\b(?:/\S*)?", re.IGNORECASE)
# "name at gmail dot com", "name (at) gmail (dot) com", "name[@]gmail.com". The ending must be a
# known TLD and a literal "." must touch it, so "meet at noon. Thanks" stays an ordinary sentence.
OBFUSCATED_EMAIL = re.compile(
    rf"[\w.+-]+{SEP}(?:@|\bat\b|\(at\)|\[at\]){SEP}[\w-]+"
    rf"(?:\s*\.|{SEP}(?:\bdot\b|\(dot\)|\[dot\]){SEP})(?:{'|'.join(TLDS)})\b",
    re.IGNORECASE,
)
# UPI ids (name@okaxis, name@ybl) and social handles (@priya.travels)
UPI_OR_HANDLE = re.compile(r"\b[\w.-]{2,}@[a-z]{2,}\b|(?<![\w@])@[\w.]{3,}", re.IGNORECASE)

# Matched with optional separators between letters, so "call me", "w h a t s a p p" and
# "t.me" all hit. Ordinary words like "signal" or "message me" are deliberately absent.
CONTACT_KEYWORDS = [
    "whatsapp", "watsapp", "whatsap", "telegram", "instagram", "insta", "snapchat",
    "facebook", "gmail", "paytm", "gpay", "googlepay", "phonepe", "venmo", "paypal",
    "callme", "textme", "dmme", "wame", "tme",
]


def _spaced(word: str) -> str:
    """Regex for a word whose letters may be split by separators: w h a t s a p p, w.h.a.t.s."""
    return SEP.join(re.escape(c) for c in word)


CONTACT_KEYWORD = re.compile(
    r"(?<![a-z])(?:" + "|".join(_spaced(w) for w in sorted(CONTACT_KEYWORDS, key=len, reverse=True)) + r")(?![a-z])",
    re.IGNORECASE,
)


class ContactInfoProhibited(ValueError):
    """Raised for obvious contact info the client should never have let through."""

    code = BLOCKED_CODE
    message = BLOCKED_MESSAGE


@dataclass
class Moderation:
    content: str  # normalized text with restricted spans replaced by PLACEHOLDER
    redacted: bool  # something was hidden
    is_blocked: bool  # nothing meaningful is left once hidden spans are removed
    warning: str | None
    reasons: list[str] = field(default_factory=list)


def normalize(text: str) -> str:
    """NFKC (fullwidth ０-９ -> 0-9, ligatures), strip zero-width chars, map every Unicode digit to ASCII."""
    text = ZERO_WIDTH.sub("", unicodedata.normalize("NFKC", text))
    return "".join(str(unicodedata.digit(c)) if c.isdigit() and not c.isascii() else c for c in text)


def obvious_violations(text: str) -> list[str]:
    """What the client-side guard blocks outright, checked against the raw text."""
    reasons = []
    if re.search(r"[0-9]", text):
        reasons.append("digits")
    if EMAIL.search(text):
        reasons.append("email")
    if URL.search(text):
        reasons.append("link")
    return reasons


def _number_run_spans(text: str) -> list[tuple[int, int]]:
    spans = []
    for m in NUMBER_RUN.finditer(text):
        run = m.group(0)
        words = len(WORD_TOKEN.findall(run))
        # one stray "one"/"do"/"ten" is ordinary language; three in a row, a multiplier
        # ("double nine") or any digit mixed in is a number being spelled out
        if re.search(r"\d", run) or words >= 3 or (MULTIPLIER_TOKEN.search(run) and words >= 2):
            spans.append(m.span())
    return spans


def find_restricted(text: str) -> tuple[list[tuple[int, int]], list[str]]:
    """Spans of restricted content in already-normalized text, plus why."""
    found: list[tuple[tuple[int, int], str]] = []
    for pattern, reason in (
        (EMAIL, "email"),
        (OBFUSCATED_EMAIL, "email"),
        (URL, "link"),
        (UPI_OR_HANDLE, "handle"),
        (CONTACT_KEYWORD, "off-platform contact"),
        (DIGIT_RUN, "digits"),
    ):
        found += [(m.span(), reason) for m in pattern.finditer(text)]
    found += [(span, "spelled-out number") for span in _number_run_spans(text)]

    # merge overlapping / touching spans so one phone number becomes one placeholder
    merged: list[list[int]] = []
    for (start, end), _ in sorted(found):
        if merged and start <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    reasons = sorted({reason for _, reason in found})
    return [(s, e) for s, e in merged], reasons


def moderate(text: str) -> Moderation:
    """Normalize and redact; never raises. Used directly by the seed and by the strict validator."""
    clean = normalize(text).strip()
    spans, reasons = find_restricted(clean)
    if not spans:
        return Moderation(clean, False, False, None, [])
    parts, cursor = [], 0
    for start, end in spans:
        parts += [clean[cursor:start], PLACEHOLDER]
        cursor = end
    parts.append(clean[cursor:])
    content = re.sub(r"[ \t]{2,}", " ", "".join(parts)).strip()
    leftover = content.replace(PLACEHOLDER, "")
    blocked = not re.search(r"[^\W\d_]{2,}", leftover)  # no real words left
    return Moderation(content, True, blocked, WARNING, reasons)


def sanitize_and_validate_message(text: str) -> Moderation:
    """Server-side guard for POST /api/conversations/{id}/messages.

    Raises ContactInfoProhibited for obvious digits / emails / links (hard block, 422);
    otherwise returns the redacted message, which may carry a moderation warning.
    """
    if obvious_violations(text):
        raise ContactInfoProhibited(BLOCKED_MESSAGE)
    return moderate(text)
