"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CategoryBar from "@/components/CategoryBar";
import FiltersModal, { countFilters, toParams, type Filters } from "@/components/FiltersModal";
import ListingCard, { ListingCardSkeleton } from "@/components/ListingCard";
import { api } from "@/lib/api";
import type { Category, ListingCard as Listing } from "@/lib/types";

const PAGE_SIZE = 20;

export default function ExplorePage() {
  return (
    <Suspense fallback={null}>
      <Explore />
    </Suspense>
  );
}

/** Parse the filter state from the URL so searches are shareable and survive refresh. */
function filtersFromParams(sp: URLSearchParams): Filters {
  const num = (k: string) => {
    const n = Number(sp.get(k) || NaN); // ignore junk instead of sending NaN to the API
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    min_price: num("min_price"),
    max_price: num("max_price"),
    bedrooms: num("bedrooms"),
    beds: num("beds"),
    bathrooms: num("bathrooms"),
    property_types: sp.get("property_types")?.split(",").filter(Boolean) ?? [],
    amenities: sp.get("amenities")?.split(",").filter(Boolean).map(Number) ?? [],
    superhost: sp.get("superhost") === "true",
    sort: sp.get("sort") ?? "recommended",
  };
}

function Explore() {
  const router = useRouter();
  const params = useSearchParams();
  const queryKey = params.toString();

  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Listing[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const searchId = useRef(0); // bumps on every new search so stale pages are dropped

  const filters = useMemo(() => filtersFromParams(new URLSearchParams(queryKey)), [queryKey]);
  const baseParams = useMemo(() => {
    const sp = new URLSearchParams(queryKey);
    return {
      location: sp.get("location") ?? undefined,
      check_in: sp.get("check_in") ?? undefined,
      check_out: sp.get("check_out") ?? undefined,
      guests: sp.get("guests") ?? undefined,
      category: sp.get("category") ?? undefined,
    };
  }, [queryKey]);

  useEffect(() => {
    api.categories().then(setCategories).catch(() => {});
  }, []);

  const load = useCallback(
    async (pageToLoad: number) => {
      // a new search (page 1) always runs and supersedes whatever is in flight;
      // "load more" waits its turn so pages never arrive twice
      if (pageToLoad > 1 && loadingRef.current) return;
      const id = pageToLoad === 1 ? ++searchId.current : searchId.current;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      try {
        const res = await api.searchListings({ ...baseParams, ...toParams(filters), page: pageToLoad, page_size: PAGE_SIZE });
        if (id !== searchId.current) return;
        setItems((prev) => (pageToLoad === 1 ? res.items : [...prev, ...res.items.filter((l) => !prev.some((p) => p.id === l.id))]));
        setTotal(res.total);
        setHasMore(res.has_more);
        setPage(pageToLoad);
      } catch (e) {
        if (id === searchId.current) setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        if (id === searchId.current) {
          loadingRef.current = false;
          setLoading(false);
        }
      }
    },
    [baseParams, filters],
  );

  // new search => reset to page 1
  useEffect(() => {
    setItems([]);
    load(1);
  }, [load]);

  // infinite scroll: load the next page when the sentinel scrolls into view
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const obs = new IntersectionObserver((entries) => entries[0].isIntersecting && load(page + 1), {
      rootMargin: "600px",
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, page, load]);

  const updateQuery = (patch: Record<string, string | number | boolean | undefined | null>) => {
    const sp = new URLSearchParams(queryKey);
    Object.entries(patch).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "" || v === false) sp.delete(k);
      else sp.set(k, String(v));
    });
    router.push(`/?${sp.toString()}`, { scroll: false });
  };

  const applyFilters = (f: Filters) => updateQuery(toParams(f));
  const clearAll = () => router.push("/");
  const activeCount = countFilters(filters);
  const hasSearch = Boolean(baseParams.location || baseParams.check_in || baseParams.guests || baseParams.category || activeCount);

  return (
    <div className="mx-auto max-w-[1760px] px-6 md:px-10 xl:px-20">
      <div className="sticky top-20 z-30 -mx-6 bg-white px-6 pt-5 md:-mx-10 md:px-10 xl:-mx-20 xl:px-20">
        <CategoryBar
          categories={categories}
          active={baseParams.category ?? null}
          onSelect={(name) => updateQuery({ category: name })}
          onOpenFilters={() => setFiltersOpen(true)}
          filterCount={activeCount}
        />
      </div>

      {hasSearch && !loading && items.length > 0 && (
        <p className="pt-6 text-sm font-semibold">
          {total > 100 ? "Over 100" : total} home{total === 1 ? "" : "s"}
          {baseParams.location ? ` in ${baseParams.location}` : ""}
        </p>
      )}

      {error && (
        <div className="py-24 text-center">
          <p className="text-lg font-semibold">We couldn&apos;t load homes right now</p>
          <p className="mt-1 text-muted">{error}</p>
          <button onClick={() => load(1)} className="mt-4 rounded-lg border border-ink px-5 py-2.5 font-semibold">
            Try again
          </button>
        </div>
      )}

      {!error && !loading && items.length === 0 && (
        <div className="py-24 text-center">
          <h2 className="text-2xl font-semibold">No exact matches</h2>
          <p className="mt-2 text-muted">Try changing or removing some of your filters or adjusting your search area.</p>
          <button onClick={clearAll} className="mt-6 rounded-lg border border-ink px-6 py-3 font-semibold hover:bg-soft">
            Remove all filters
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-6 gap-y-10 pt-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {items.map((l) => (
          <ListingCard key={l.id} listing={l} checkIn={baseParams.check_in} checkOut={baseParams.check_out} guests={baseParams.guests} />
        ))}
        {loading && Array.from({ length: items.length ? 4 : 10 }).map((_, i) => <ListingCardSkeleton key={`s${i}`} />)}
      </div>

      <div ref={sentinel} className="h-px" />
      {hasMore && !loading && (
        <div className="mt-12 flex flex-col items-center gap-3">
          <p className="font-semibold">Continue exploring homes</p>
          <button onClick={() => load(page + 1)} className="rounded-lg bg-ink px-6 py-3 font-semibold text-white hover:bg-black">
            Show more
          </button>
        </div>
      )}

      <FiltersModal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        value={filters}
        onApply={applyFilters}
        baseParams={baseParams}
      />
    </div>
  );
}
