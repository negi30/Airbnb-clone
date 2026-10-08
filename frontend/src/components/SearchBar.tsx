"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MapPin, Search } from "lucide-react";
import DateRangeCalendar from "./DateRangeCalendar";
import { Counter } from "./ui";
import { formatShortDate, guestsParam } from "@/lib/format";

type Panel = "where" | "checkin" | "checkout" | "who" | null;

const SUGGESTIONS = [
  { name: "Goa, India", hint: "For sights like Baga Beach" },
  { name: "Manali, India", hint: "For its stunning mountain views" },
  { name: "Jaipur, India", hint: "For its stunning architecture" },
  { name: "Kerala, India", hint: "Popular beach destination" },
  { name: "Bali, Indonesia", hint: "For a tropical escape" },
  { name: "Paris, France", hint: "For its bustling nightlife" },
];

/**
 * Where / Check in / Check out / Who — reads and writes the URL query string.
 * With `basePath` (Experiences/Services), dates collapse to a single "When" day (`?date=`).
 */
export default function SearchBar({
  stacked = false,
  onDone,
  basePath,
}: {
  stacked?: boolean;
  onDone?: () => void;
  basePath?: "/experiences" | "/services";
}) {
  const singleDay = Boolean(basePath);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryKey = params.toString();
  const [panel, setPanel] = useState<Panel>(null);
  const [location, setLocation] = useState(params.get("location") ?? "");
  const [checkIn, setCheckIn] = useState<string | null>(params.get(singleDay ? "date" : "check_in"));
  const [checkOut, setCheckOut] = useState<string | null>(params.get("check_out"));
  const [adults, setAdults] = useState(() => guestsParam(params.get("guests"), 0));
  const [children, setChildren] = useState(0);
  const [infants, setInfants] = useState(0);
  const [pets, setPets] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // follow the URL: "Remove all filters", back/forward or a new search elsewhere must not
  // leave stale values in the bar that the next search would quietly re-apply
  useEffect(() => {
    const sp = new URLSearchParams(queryKey);
    setLocation(sp.get("location") ?? "");
    setCheckIn(sp.get(singleDay ? "date" : "check_in"));
    setCheckOut(singleDay ? null : sp.get("check_out"));
    setAdults(guestsParam(sp.get("guests"), 0));
    setChildren(0);
    setInfants(0);
    setPets(0);
  }, [queryKey, singleDay]);

  // close popovers on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setPanel(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const guests = adults + children;
  const guestLabel = guests
    ? `${guests} guest${guests > 1 ? "s" : ""}${infants ? `, ${infants} infant${infants > 1 ? "s" : ""}` : ""}`
    : "Add guests";

  function submit() {
    // keep filters only when searching from the results page itself (not ?tab= from /trips etc.)
    const target = singleDay ? basePath : "/";
    const sp = new URLSearchParams(pathname === target ? queryKey : "");
    const set = (k: string, v: string | null) => (v ? sp.set(k, v) : sp.delete(k));
    set("location", location.trim() || null);
    set("guests", guests ? String(guests) : null);
    setPanel(null);
    onDone?.();
    if (singleDay) {
      set("date", checkIn);
      sp.delete("category");
      router.push(`${basePath}?${sp.toString()}`);
      return;
    }
    set("check_in", checkIn && checkOut ? checkIn : null);
    set("check_out", checkIn && checkOut ? checkOut : null);
    router.push(`/?${sp.toString()}`);
  }

  function onDates(a: string | null, b: string | null) {
    if (singleDay) {
      // the range calendar reports a later click as a checkout; treat it as the new day
      setCheckIn(b ?? a);
      setCheckOut(null);
      if (b ?? a) setPanel("who");
      return;
    }
    setCheckIn(a);
    setCheckOut(b);
    setPanel(b ? "who" : "checkout");
  }

  const seg = (name: Exclude<Panel, null>) =>
    `relative flex-1 cursor-pointer rounded-full px-6 py-3.5 text-left transition ${
      panel === name ? "bg-white shadow-search" : "hover:bg-gray-200/70"
    }`;

  const whoPanel = (
    <div className="divide-y divide-line">
      {[
        { label: "Adults", hint: "Ages 13 or above", value: adults, set: setAdults },
        { label: "Children", hint: "Ages 2–12", value: children, set: setChildren },
        { label: "Infants", hint: "Under 2", value: infants, set: setInfants },
        { label: "Pets", hint: "Bringing a service animal?", value: pets, set: setPets },
      ].map((row) => (
        <div key={row.label} className="flex items-center justify-between py-4">
          <div>
            <p className="font-semibold">{row.label}</p>
            <p className="text-sm text-muted">{row.hint}</p>
          </div>
          <Counter
            value={row.value}
            onChange={(v) => {
              row.set(v);
              if (row.label !== "Adults" && v > 0 && adults === 0) setAdults(1);
            }}
            // children, infants and pets need an adult
            min={row.label === "Adults" && children + infants + pets > 0 ? 1 : 0}
            max={row.label === "Adults" ? 16 : 5}
          />
        </div>
      ))}
    </div>
  );

  const wherePanel = (
    <div>
      <p className="mb-3 px-2 text-xs font-semibold text-ink">Suggested destinations</p>
      {SUGGESTIONS.map((s) => (
        <button
          key={s.name}
          type="button"
          onClick={() => {
            setLocation(s.name);
            setPanel("checkin");
          }}
          className="flex w-full items-center gap-4 rounded-xl p-2 text-left hover:bg-soft"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-soft">
            <MapPin className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-medium">{s.name}</span>
            <span className="block text-xs text-muted">{s.hint}</span>
          </span>
        </button>
      ))}
    </div>
  );

  // ---------- mobile / modal layout ----------
  if (stacked) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-line p-4 shadow-sm">
          <p className="mb-2 text-xl font-bold">Where?</p>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Search destinations"
            className="w-full rounded-xl border border-line px-4 py-3 outline-none focus:border-ink"
          />
        </div>
        <div className="rounded-2xl border border-line p-4 shadow-sm">
          <p className="mb-3 text-xl font-bold">When?</p>
          <DateRangeCalendar
            checkIn={checkIn}
            checkOut={checkOut}
            onChange={(a, b) => (singleDay ? setCheckIn(b ?? a) : (setCheckIn(a), setCheckOut(b)))}
            months={1}
          />
        </div>
        <div className="rounded-2xl border border-line p-4 shadow-sm">
          <p className="text-xl font-bold">Who?</p>
          {whoPanel}
        </div>
        <button onClick={submit} className="brand-gradient flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-semibold text-white">
          <Search className="h-4 w-4" /> Search
        </button>
      </div>
    );
  }

  // ---------- desktop pill ----------
  return (
    <div ref={ref} className="relative mx-auto w-full max-w-[850px]">
      <div
        className={`flex items-center rounded-full border border-line text-sm shadow-search ${panel ? "bg-gray-100" : "bg-white"}`}
      >
        <div className={`${seg("where")} flex-[1.4]`} onClick={() => setPanel("where")}>
          <p className="text-xs font-semibold">Where</p>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={singleDay ? "Search by city or landmark" : "Search destinations"}
            className="w-full truncate bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
        </div>
        <span className="h-8 w-px bg-line" />
        {singleDay ? (
          <div className={`${seg("checkin")} flex-[1.2]`} onClick={() => setPanel("checkin")}>
            <p className="text-xs font-semibold">When</p>
            <p className={checkIn ? "text-ink" : "text-muted"}>{checkIn ? formatShortDate(checkIn) : "Add dates"}</p>
          </div>
        ) : (
          <>
            <div className={seg("checkin")} onClick={() => setPanel("checkin")}>
              <p className="text-xs font-semibold">Check in</p>
              <p className={checkIn ? "text-ink" : "text-muted"}>{checkIn ? formatShortDate(checkIn) : "Add dates"}</p>
            </div>
            <span className="h-8 w-px bg-line" />
            <div className={seg("checkout")} onClick={() => setPanel(checkIn ? "checkout" : "checkin")}>
              <p className="text-xs font-semibold">Check out</p>
              <p className={checkOut ? "text-ink" : "text-muted"}>{checkOut ? formatShortDate(checkOut) : "Add dates"}</p>
            </div>
          </>
        )}
        <span className="h-8 w-px bg-line" />
        <div className={`${seg("who")} flex items-center justify-between gap-2 py-2 pr-2`} onClick={() => setPanel("who")}>
          <div className="min-w-0">
            <p className="text-xs font-semibold">Who</p>
            <p className={`truncate ${guests ? "text-ink" : "text-muted"}`}>{guestLabel}</p>
          </div>
          <button
            type="button"
            aria-label="Search"
            onClick={(e) => {
              e.stopPropagation();
              submit();
            }}
            className="flex h-12 shrink-0 items-center gap-2 rounded-full bg-brand px-4 font-semibold text-white hover:bg-brand-dark"
          >
            <Search className="h-4 w-4" strokeWidth={3} />
            {panel && <span>Search</span>}
          </button>
        </div>
      </div>

      {panel === "where" && (
        <div className="absolute left-0 top-[calc(100%+12px)] z-50 w-[420px] rounded-3xl bg-white p-6 shadow-card">
          {wherePanel}
        </div>
      )}
      {(panel === "checkin" || panel === "checkout") && (
        <div className="absolute left-1/2 top-[calc(100%+12px)] z-50 w-[760px] -translate-x-1/2 rounded-3xl bg-white p-8 shadow-card">
          <DateRangeCalendar checkIn={checkIn} checkOut={checkOut} onChange={onDates} />
          {(checkIn || checkOut) && (
            <div className="mt-4 flex justify-end">
              <button className="text-sm font-semibold underline" onClick={() => onDates(null, null)}>
                Clear dates
              </button>
            </div>
          )}
        </div>
      )}
      {panel === "who" && (
        <div className="absolute right-0 top-[calc(100%+12px)] z-50 w-[420px] rounded-3xl bg-white px-8 py-4 shadow-card">
          {whoPanel}
        </div>
      )}
    </div>
  );
}
