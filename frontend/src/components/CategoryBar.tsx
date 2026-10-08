"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { categoryIcon } from "@/lib/icons";
import type { Category } from "@/lib/types";

export default function CategoryBar({
  categories,
  active,
  onSelect,
  onOpenFilters,
  filterCount,
}: {
  categories: Category[];
  active: string | null;
  onSelect: (name: string | null) => void;
  onOpenFilters: () => void;
  filterCount: number;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: true });

  const updateEdges = () => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(updateEdges, [categories]);

  const scroll = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * 400, behavior: "smooth" });

  return (
    <div className="flex items-center gap-6">
      <div className="relative min-w-0 flex-1">
        {edges.left && (
          <button
            aria-label="Scroll left"
            onClick={() => scroll(-1)}
            className="absolute left-0 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-gray-300 bg-white shadow-sm hover:shadow-md md:flex"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <div ref={scroller} onScroll={updateEdges} className="no-scrollbar flex gap-8 overflow-x-auto scroll-smooth">
          {categories.map((c) => {
            const Icon = categoryIcon(c.name);
            const isActive = active === c.name;
            return (
              <button
                key={c.name}
                onClick={() => onSelect(isActive ? null : c.name)}
                className={`group flex shrink-0 flex-col items-center gap-2 border-b-2 pb-3 pt-1 transition ${
                  isActive ? "border-ink text-ink" : "border-transparent text-muted hover:border-gray-300 hover:text-ink"
                }`}
              >
                <Icon className="h-6 w-6" strokeWidth={1.6} />
                <span className="whitespace-nowrap text-xs font-semibold">{c.name}</span>
              </button>
            );
          })}
        </div>
        {edges.right && (
          <button
            aria-label="Scroll right"
            onClick={() => scroll(1)}
            className="absolute right-0 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-gray-300 bg-white shadow-sm hover:shadow-md md:flex"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
        {edges.right && <div className="pointer-events-none absolute right-0 top-0 h-full w-20 bg-gradient-to-l from-white" />}
      </div>
      <button
        onClick={onOpenFilters}
        className="relative flex shrink-0 items-center gap-2 rounded-xl border border-line px-4 py-3.5 text-xs font-semibold hover:border-ink hover:bg-soft"
      >
        <SlidersHorizontal className="h-4 w-4" />
        <span className="hidden sm:inline">Filters</span>
        {filterCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[10px] text-white">
            {filterCount}
          </span>
        )}
      </button>
    </div>
  );
}
