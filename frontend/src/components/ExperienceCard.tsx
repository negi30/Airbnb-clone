"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Heart } from "lucide-react";
import { RatingStar, SafeImage } from "./ui";
import { useApp } from "@/context/AppProvider";
import { formatDuration, formatPrice, formatSlotBadge } from "@/lib/format";
import type { ExperienceCard as Experience } from "@/lib/types";

export const experienceHref = (e: Pick<Experience, "id" | "kind">) =>
  `/${e.kind === "service" ? "services" : "experiences"}/${e.id}`;

export function ExperienceHeart({ experience, className = "" }: { experience: Experience; className?: string }) {
  const { savedExperienceIds, toggleSavedExperience } = useApp();
  const saved = savedExperienceIds.has(experience.id);
  return (
    <button
      aria-label={saved ? "Remove from wishlist" : "Save to wishlist"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSavedExperience(experience.id, { image: experience.photos[0] });
      }}
      className={`transition active:scale-90 ${className}`}
    >
      <Heart className={`h-6 w-6 stroke-white stroke-[2.5] drop-shadow ${saved ? "fill-brand" : "fill-black/50"}`} />
    </button>
  );
}

/**
 * Photo-forward card from the Experiences/Services tabs.
 * `badge`: "time" shows "4pm" (single-day rows), "day" shows "Fri · 10am", "none" hides it.
 */
export default function ExperienceCard({
  experience,
  badge = "day",
  showMeta = false,
}: {
  experience: Experience;
  badge?: "time" | "day" | "none";
  showMeta?: boolean;
}) {
  return (
    <Link href={experienceHref(experience)} className="group block">
      <div className="relative aspect-[20/19] overflow-hidden rounded-2xl bg-soft">
        <SafeImage
          src={experience.photos[0] ?? ""}
          seed={`exp-${experience.id}`}
          alt={experience.title}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />
        {badge !== "none" && experience.next_slot && (
          <span className="absolute left-3 top-3 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold shadow-sm">
            {formatSlotBadge(experience.next_slot, badge === "day")}
          </span>
        )}
        <ExperienceHeart experience={experience} className="absolute right-3 top-3" />
      </div>
      <div className="mt-2.5 text-[15px] leading-5">
        <p className="line-clamp-2 font-semibold">{experience.title}</p>
        {showMeta && (
          <p className="text-sm text-muted">
            {experience.category} · {formatDuration(experience.duration_minutes)}
          </p>
        )}
        <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
          From {formatPrice(experience.price_per_guest)} / guest
          {experience.rating !== null && (
            <>
              <span>·</span>
              <RatingStar className="h-3 w-3 text-ink" /> {experience.rating.toFixed(experience.rating % 1 ? 2 : 1)}
            </>
          )}
        </p>
      </div>
    </Link>
  );
}

export function ExperienceCardSkeleton() {
  return (
    <div>
      <div className="skeleton aspect-[20/19] rounded-2xl" />
      <div className="skeleton mt-3 h-4 w-4/5 rounded" />
      <div className="skeleton mt-2 h-4 w-1/2 rounded" />
    </div>
  );
}

/** Titled horizontal carousel with arrow buttons, like "Happening today in …". */
export function ExperienceRow({
  title,
  href,
  items,
  loading,
  badge,
  showMeta,
  empty,
}: {
  title: string;
  href?: string;
  items: Experience[];
  loading?: boolean;
  badge?: "time" | "day" | "none";
  showMeta?: boolean;
  empty?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const updateEdges = () => {
    const el = scroller.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(updateEdges, [items, loading]);

  const scroll = (dir: 1 | -1) => {
    const el = scroller.current;
    el?.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: "smooth" });
  };

  if (!loading && items.length === 0 && !empty) return null;

  const arrow = "flex h-8 w-8 items-center justify-center rounded-full border border-line bg-white transition hover:shadow-card disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:shadow-none";

  return (
    <section className="py-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="flex items-center gap-2 text-[22px] font-semibold">
          {href ? (
            <Link href={href} className="group flex items-center gap-2">
              {title}
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-soft transition group-hover:bg-line">
                <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          ) : (
            title
          )}
        </h2>
        <div className="hidden gap-2 md:flex">
          <button aria-label="Previous" className={arrow} disabled={!edges.left} onClick={() => scroll(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button aria-label="Next" className={arrow} disabled={!edges.right} onClick={() => scroll(1)}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      {!loading && items.length === 0 ? (
        <p className="text-muted">{empty}</p>
      ) : (
        <div
          ref={scroller}
          onScroll={updateEdges}
          className="no-scrollbar -mx-1 flex snap-x gap-4 overflow-x-auto scroll-smooth px-1"
        >
          {(loading ? Array.from({ length: 7 }) : items).map((item, i) => (
            <div key={loading ? i : (item as Experience).id} className="w-[46%] shrink-0 snap-start sm:w-[30%] md:w-[23%] lg:w-[18.5%] xl:w-[13.4%]">
              {loading ? <ExperienceCardSkeleton /> : <ExperienceCard experience={item as Experience} badge={badge} showMeta={showMeta} />}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
