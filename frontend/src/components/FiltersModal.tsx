"use client";

import { useEffect, useState } from "react";
import { Building, Building2, Castle, Home, Hotel, TreePine, Warehouse } from "lucide-react";
import { Modal } from "./ui";
import { api } from "@/lib/api";
import { amenityIcon } from "@/lib/icons";
import { formatPrice } from "@/lib/format";
import type { Amenity, PriceStats } from "@/lib/types";

export interface Filters {
  min_price?: number;
  max_price?: number;
  bedrooms?: number;
  beds?: number;
  bathrooms?: number;
  property_types: string[];
  amenities: number[];
  superhost: boolean;
  sort: string;
}

export const EMPTY_FILTERS: Filters = { property_types: [], amenities: [], superhost: false, sort: "recommended" };

export function countFilters(f: Filters) {
  return (
    (f.min_price !== undefined || f.max_price !== undefined ? 1 : 0) +
    (f.bedrooms ? 1 : 0) +
    (f.beds ? 1 : 0) +
    (f.bathrooms ? 1 : 0) +
    f.property_types.length +
    f.amenities.length +
    (f.superhost ? 1 : 0) +
    (f.sort !== "recommended" ? 1 : 0)
  );
}

const TYPE_ICONS: Record<string, typeof Home> = {
  House: Home, Apartment: Building2, Villa: Castle, Cabin: TreePine, Cottage: Warehouse, Guesthouse: Building, Hotel: Hotel,
};

export default function FiltersModal({
  open,
  onClose,
  value,
  onApply,
  baseParams,
}: {
  open: boolean;
  onClose: () => void;
  value: Filters;
  onApply: (f: Filters) => void;
  baseParams: Record<string, string | number | undefined>;
}) {
  const [draft, setDraft] = useState<Filters>(value);
  const [stats, setStats] = useState<PriceStats | null>(null);
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  useEffect(() => {
    if (!open || stats) return;
    api.priceStats().then(setStats).catch(() => {});
    api.amenities().then(setAmenities).catch(() => {});
    api.propertyTypes().then(setTypes).catch(() => {});
  }, [open, stats]);

  // live "Show N places" count, debounced
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api
        .searchListings({ ...baseParams, ...toParams(draft), page_size: 1 })
        .then((r) => setCount(r.total))
        .catch(() => setCount(null));
    }, 250);
    return () => clearTimeout(t);
  }, [open, draft, baseParams]);

  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const maxHist = stats ? Math.max(...stats.histogram, 1) : 1;
  const lo = draft.min_price ?? stats?.min ?? 0;
  const hi = draft.max_price ?? stats?.max ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Filters"
      wide
      footer={
        <div className="flex items-center justify-between">
          <button className="font-semibold underline" onClick={() => setDraft(EMPTY_FILTERS)}>
            Clear all
          </button>
          <button
            onClick={() => {
              onApply(draft);
              onClose();
            }}
            className="rounded-lg bg-ink px-6 py-3.5 font-semibold text-white hover:bg-black"
          >
            {count === null ? "Show places" : count === 0 ? "No exact matches" : `Show ${count} place${count === 1 ? "" : "s"}`}
          </button>
        </div>
      }
    >
      <section className="border-b border-line pb-8">
        <h3 className="text-[22px] font-semibold">Sort by</h3>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ["recommended", "Recommended"],
            ["price_asc", "Price: low to high"],
            ["price_desc", "Price: high to low"],
            ["rating", "Top rated"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setDraft({ ...draft, sort: key })}
              className={`rounded-full border px-5 py-2.5 text-sm ${
                draft.sort === key ? "border-ink bg-ink text-white" : "border-line hover:border-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="border-b border-line py-8">
        <h3 className="text-[22px] font-semibold">Price range</h3>
        <p className="mt-1 text-sm text-muted">Nightly prices before fees and taxes</p>
        {stats && (
          <>
            <div className="mt-6 flex h-20 items-end gap-[3px] px-2">
              {stats.histogram.map((h, i) => {
                const bucketPrice = stats.min + ((stats.max - stats.min) / stats.histogram.length) * i;
                const inRange = bucketPrice >= lo && bucketPrice <= hi;
                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-t-sm ${inRange ? "bg-brand" : "bg-gray-200"}`}
                    style={{ height: `${Math.max(4, (h / maxHist) * 100)}%` }}
                  />
                );
              })}
            </div>
            <div className="relative h-6">
              <input
                type="range"
                min={stats.min}
                max={stats.max}
                step={100}
                value={lo}
                onChange={(e) => setDraft({ ...draft, min_price: Math.min(Number(e.target.value), hi - 100) })}
                className="pointer-events-none absolute inset-x-0 top-1 w-full appearance-none bg-transparent accent-ink [&::-webkit-slider-thumb]:pointer-events-auto"
              />
              <input
                type="range"
                min={stats.min}
                max={stats.max}
                step={100}
                value={hi}
                onChange={(e) => setDraft({ ...draft, max_price: Math.max(Number(e.target.value), lo + 100) })}
                className="pointer-events-none absolute inset-x-0 top-1 w-full appearance-none bg-transparent accent-ink [&::-webkit-slider-thumb]:pointer-events-auto"
              />
            </div>
            <div className="mt-4 flex items-center justify-between gap-6">
              {[
                ["Minimum", lo, "min_price"],
                ["Maximum", hi, "max_price"],
              ].map(([label, v, key]) => (
                <label key={key as string} className="flex-1 rounded-full border border-line px-5 py-2 text-center">
                  <span className="block text-xs text-muted">{label as string}</span>
                  <span className="text-base">{formatPrice(v as number)}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="border-b border-line py-8">
        <h3 className="text-[22px] font-semibold">Rooms and beds</h3>
        {(["bedrooms", "beds", "bathrooms"] as const).map((key) => (
          <div key={key} className="mt-5">
            <p className="mb-3 capitalize">{key}</p>
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
                const selected = (draft[key] ?? 0) === n;
                return (
                  <button
                    key={n}
                    onClick={() => setDraft({ ...draft, [key]: n || undefined })}
                    className={`min-w-[56px] rounded-full border px-5 py-2.5 text-sm ${
                      selected ? "border-ink bg-ink text-white" : "border-line hover:border-ink"
                    }`}
                  >
                    {n === 0 ? "Any" : n === 8 ? "8+" : n}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="border-b border-line py-8">
        <h3 className="text-[22px] font-semibold">Property type</h3>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {types.map((t) => {
            const Icon = TYPE_ICONS[t] ?? Home;
            const selected = draft.property_types.includes(t);
            return (
              <button
                key={t}
                onClick={() => setDraft({ ...draft, property_types: toggle(draft.property_types, t) })}
                className={`flex h-28 flex-col justify-between rounded-xl border p-4 text-left ${
                  selected ? "border-2 border-ink bg-soft" : "border-line hover:border-ink"
                }`}
              >
                <Icon className="h-7 w-7" strokeWidth={1.5} />
                <span className="font-semibold">{t}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="border-b border-line py-8">
        <h3 className="text-[22px] font-semibold">Amenities</h3>
        <div className="mt-5 flex flex-wrap gap-3">
          {amenities.map((a) => {
            const Icon = amenityIcon(a.icon);
            const selected = draft.amenities.includes(a.id);
            return (
              <button
                key={a.id}
                onClick={() => setDraft({ ...draft, amenities: toggle(draft.amenities, a.id) })}
                className={`flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm ${
                  selected ? "border-2 border-ink bg-soft" : "border-line hover:border-ink"
                }`}
              >
                <Icon className="h-4 w-4" />
                {a.name}
              </button>
            );
          })}
        </div>
      </section>

      <section className="py-8">
        <label className="flex cursor-pointer items-center justify-between">
          <span>
            <span className="block text-[22px] font-semibold">Superhost</span>
            <span className="text-sm text-muted">Stay with recognised hosts</span>
          </span>
          <input
            type="checkbox"
            checked={draft.superhost}
            onChange={(e) => setDraft({ ...draft, superhost: e.target.checked })}
            className="h-6 w-6 accent-ink"
          />
        </label>
      </section>
    </Modal>
  );
}

export function toParams(f: Filters): Record<string, string | number | boolean | undefined> {
  return {
    min_price: f.min_price,
    max_price: f.max_price,
    bedrooms: f.bedrooms,
    beds: f.beds,
    bathrooms: f.bathrooms,
    property_types: f.property_types.join(",") || undefined,
    amenities: f.amenities.join(",") || undefined,
    superhost: f.superhost || undefined,
    sort: f.sort !== "recommended" ? f.sort : undefined,
  };
}
