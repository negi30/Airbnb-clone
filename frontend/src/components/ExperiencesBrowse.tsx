"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ExperienceCard, { ExperienceCardSkeleton, ExperienceRow } from "./ExperienceCard";
import { api } from "@/lib/api";
import { addDays, formatLongDate, plural, todayISO, weekendRange } from "@/lib/format";
import type { Category, ExperienceCard as Experience, ExperienceKind } from "@/lib/types";

const COPY: Record<ExperienceKind, { noun: string; plural: string; base: "/experiences" | "/services" }> = {
  experience: { noun: "experience", plural: "Experiences", base: "/experiences" },
  service: { noun: "service", plural: "Services", base: "/services" },
};

/**
 * Experiences / Services tab.
 * - No date or category in the URL: "Happening today / Tomorrow / This weekend" rows,
 *   then one row per category.
 * - `?date=` or `?category=`: a results grid (search state lives in the URL, as on Homes).
 */
export default function ExperiencesBrowse({ kind }: { kind: ExperienceKind }) {
  const router = useRouter();
  const params = useSearchParams();
  const queryKey = params.toString();
  const copy = COPY[kind];

  const location = params.get("location") ?? undefined;
  const day = params.get("date") ?? undefined;
  const guests = params.get("guests") ?? undefined;
  const category = params.get("category") ?? undefined;
  const gridMode = Boolean(day || category);
  const where = location ? ` in ${location.split(",")[0]}` : "";

  const [categories, setCategories] = useState<Category[]>([]);
  const [rows, setRows] = useState<{ today: Experience[]; tomorrow: Experience[]; weekend: Experience[]; all: Experience[] } | null>(null);
  const [results, setResults] = useState<{ items: Experience[]; total: number; hasMore: boolean; page: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.experienceCategories(kind).then(setCategories).catch(() => setCategories([]));
  }, [kind]);

  useEffect(() => {
    setError(null);
    let stale = false; // a newer search (URL change) supersedes this one
    const fail = (e: unknown) => !stale && setError(e instanceof Error ? e.message : "Something went wrong");
    const common = { kind, location, guests };
    if (gridMode) {
      setResults(null);
      api
        .searchExperiences({ ...common, category, date_from: day, date_to: day, sort: day ? "soonest" : "rating", page_size: 24 })
        .then((r) => !stale && setResults({ items: r.items, total: r.total, hasMore: r.has_more, page: 1 }))
        .catch(fail);
      return () => {
        stale = true;
      };
    }
    setRows(null);
    const today = todayISO();
    const tomorrow = addDays(today, 1);
    const [sat, sun] = weekendRange();
    const inWindow = (from: string, to: string) =>
      api.searchExperiences({ ...common, date_from: from, date_to: to, sort: "soonest", page_size: 20 }).then((r) => r.items);
    Promise.all([
      inWindow(today, today),
      inWindow(tomorrow, tomorrow),
      inWindow(sat, sun),
      api.searchExperiences({ ...common, sort: "rating", page_size: 50 }).then((r) => r.items),
    ])
      .then(([t, tm, w, all]) => !stale && setRows({ today: t, tomorrow: tm, weekend: w, all }))
      .catch(fail);
    return () => {
      stale = true;
    };
    // queryKey captures every URL-driven input above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, kind]);

  const [loadingMore, setLoadingMore] = useState(false);
  const loadMore = async () => {
    if (!results || loadingMore) return;
    const next = results.page + 1;
    setLoadingMore(true);
    try {
      const r = await api.searchExperiences({ kind, location, guests, category, date_from: day, date_to: day, sort: day ? "soonest" : "rating", page: next, page_size: 24 });
      setResults((cur) =>
        cur && cur.page === results.page
          ? { items: [...cur.items, ...r.items.filter((e) => !cur.items.some((x) => x.id === e.id))], total: r.total, hasMore: r.has_more, page: next }
          : cur,
      );
    } catch {
      /* keep what's shown; the button stays so the guest can retry */
    } finally {
      setLoadingMore(false);
    }
  };

  const byCategory = useMemo(() => {
    const groups = new Map<string, Experience[]>();
    rows?.all.forEach((e) => groups.set(e.category, [...(groups.get(e.category) ?? []), e]));
    return categories.map((c) => ({ name: c.name, items: groups.get(c.name) ?? [] })).filter((g) => g.items.length);
  }, [rows, categories]);

  const setCategory = (name: string | null) => {
    const sp = new URLSearchParams(queryKey);
    if (name) sp.set("category", name);
    else sp.delete("category");
    router.push(`${copy.base}${sp.toString() ? `?${sp}` : ""}`);
  };

  const [sat] = weekendRange();
  const withQuery = (extra: Record<string, string>) => {
    const sp = new URLSearchParams(queryKey);
    Object.entries(extra).forEach(([k, v]) => sp.set(k, v));
    return `${copy.base}?${sp}`;
  };

  return (
    <div className="mx-auto max-w-[1760px] px-6 pb-16 pt-4 md:px-10 xl:px-20">
      {/* category chips */}
      {categories.length > 0 && (
        <div className="no-scrollbar -mx-1 mb-2 flex gap-2 overflow-x-auto px-1 py-3">
          <Chip active={!category} onClick={() => setCategory(null)}>All</Chip>
          {categories.map((c) => (
            <Chip key={c.name} active={category === c.name} onClick={() => setCategory(c.name)}>
              {c.name}
            </Chip>
          ))}
        </div>
      )}

      {error && (
        <div className="py-24 text-center">
          <p className="text-lg font-semibold">Couldn&apos;t load {copy.plural.toLowerCase()}</p>
          <p className="mt-1 text-muted">{error}</p>
        </div>
      )}

      {!error && gridMode && (
        <section className="pt-4">
          <h1 className="text-[22px] font-semibold">
            {results ? plural(results.total, copy.noun) : copy.plural}
            {category ? ` · ${category}` : ""}
            {where}
            {day ? ` on ${formatLongDate(day)}` : ""}
          </h1>
          {(day || location || guests) && (
            <Link href={category ? `${copy.base}?category=${encodeURIComponent(category)}` : copy.base} className="mt-1 inline-block text-sm font-semibold underline">
              Clear search
            </Link>
          )}
          {results && results.items.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-lg font-semibold">No {copy.plural.toLowerCase()} match your search</p>
              <p className="mt-1 text-muted">Try another date, fewer guests, or a different place.</p>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {results
                ? results.items.map((e) => <ExperienceCard key={e.id} experience={e} badge={day ? "time" : "day"} showMeta />)
                : Array.from({ length: 12 }).map((_, i) => <ExperienceCardSkeleton key={i} />)}
            </div>
          )}
          {results?.hasMore && (
            <div className="mt-10 text-center">
              <button onClick={loadMore} disabled={loadingMore} className="rounded-lg bg-ink px-6 py-3 font-semibold text-white disabled:opacity-60">
                {loadingMore ? "Loading…" : "Show more"}
              </button>
            </div>
          )}
        </section>
      )}

      {!error && !gridMode && (
        <>
          <ExperienceRow
            title={`Happening today${where}`}
            href={withQuery({ date: todayISO() })}
            items={rows?.today ?? []}
            loading={!rows}
            badge="time"
            empty={`Nothing left today${where} — try tomorrow.`}
          />
          <ExperienceRow
            title={`Tomorrow${where}`}
            href={withQuery({ date: addDays(todayISO(), 1) })}
            items={rows?.tomorrow ?? []}
            loading={!rows}
            badge="time"
          />
          <ExperienceRow
            title={`${copy.plural} this weekend`}
            href={withQuery({ date: sat })}
            items={rows?.weekend ?? []}
            loading={!rows}
            badge="day"
          />
          {byCategory.map((g) => (
            <ExperienceRow
              key={g.name}
              title={g.name}
              href={withQuery({ category: g.name })}
              items={g.items}
              badge="none"
              showMeta
            />
          ))}
          {rows && rows.all.length === 0 && (
            <div className="py-20 text-center">
              <p className="text-lg font-semibold">No {copy.plural.toLowerCase()}{where} yet</p>
              <Link href={copy.base} className="mt-2 inline-block font-semibold underline">
                See everything
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition ${
        active ? "border-ink bg-ink text-white" : "border-line hover:border-ink"
      }`}
    >
      {children}
    </button>
  );
}
