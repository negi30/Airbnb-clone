"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import ListingCard, { ListingCardSkeleton } from "@/components/ListingCard";
import { ExperienceRow } from "@/components/ExperienceCard";
import { api } from "@/lib/api";
import { addDays, todayISO } from "@/lib/format";
import type { ExperienceCard, ListingCard as Listing } from "@/lib/types";

/** "All" tab: a sampler of homes, experiences and services, each linking to its own tab. */
export default function AllPage() {
  const [homes, setHomes] = useState<Listing[] | null>(null);
  const [today, setToday] = useState<ExperienceCard[] | null>(null);
  const [services, setServices] = useState<ExperienceCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Something went wrong");
    api.searchListings({ sort: "rating", page_size: 12 }).then((r) => setHomes(r.items)).catch(fail);
    const day = todayISO();
    api
      .searchExperiences({ kind: "experience", date_from: day, date_to: addDays(day, 1), sort: "soonest", page_size: 20 })
      .then((r) => setToday(r.items))
      .catch(fail);
    api.searchExperiences({ kind: "service", sort: "rating", page_size: 20 }).then((r) => setServices(r.items)).catch(fail);
  }, []);

  if (error)
    return (
      <div className="py-24 text-center">
        <p className="text-lg font-semibold">Couldn&apos;t load this page</p>
        <p className="mt-1 text-muted">{error}</p>
      </div>
    );

  return (
    <div className="mx-auto max-w-[1760px] px-6 pb-16 pt-4 md:px-10 xl:px-20">
      <section className="py-5">
        <h2 className="mb-4 text-[22px] font-semibold">
          <Link href="/" className="group inline-flex items-center gap-2">
            Top-rated homes
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-soft transition group-hover:bg-line">
              <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </h2>
        <div className="no-scrollbar -mx-1 flex snap-x gap-4 overflow-x-auto px-1">
          {(homes ?? Array.from({ length: 6 })).map((l, i) => (
            <div key={homes ? (l as Listing).id : i} className="w-[70%] shrink-0 snap-start sm:w-[40%] md:w-[30%] lg:w-[23%] xl:w-[18.5%]">
              {homes ? <ListingCard listing={l as Listing} /> : <ListingCardSkeleton />}
            </div>
          ))}
        </div>
      </section>
      <ExperienceRow
        title="Experiences happening soon"
        href="/experiences"
        items={today ?? []}
        loading={!today}
        badge="day"
        empty="No experiences in the next two days."
      />
      <ExperienceRow title="Popular services" href="/services" items={services ?? []} loading={!services} badge="none" showMeta />
    </div>
  );
}
