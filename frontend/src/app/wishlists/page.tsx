"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import ExperienceCard from "@/components/ExperienceCard";
import ListingCard from "@/components/ListingCard";
import { Spinner } from "@/components/ui";
import { useApp } from "@/context/AppProvider";
import { api } from "@/lib/api";
import type { ExperienceCard as Experience, ListingCard as Listing } from "@/lib/types";

export default function WishlistsPage() {
  const { user, wishlistIds, savedExperienceIds } = useApp();
  const [items, setItems] = useState<Listing[] | null>(null);
  const [experiences, setExperiences] = useState<Experience[] | null>(null);

  useEffect(() => {
    if (!user) return;
    let stale = false;
    setItems(null); // never show the previous account's saves
    setExperiences(null);
    api.wishlist().then((l) => !stale && setItems(l)).catch(() => !stale && setItems([]));
    api.savedExperiences().then((l) => !stale && setExperiences(l)).catch(() => !stale && setExperiences([]));
    return () => {
      stale = true;
    };
  }, [user]);

  if (!items || !experiences) return <Spinner />;
  // hide items un-hearted on this page without refetching
  const visible = items.filter((l) => wishlistIds.has(l.id));
  const visibleExperiences = experiences.filter((e) => savedExperienceIds.has(e.id));

  return (
    <div className="mx-auto max-w-[1760px] px-6 py-10 md:px-10 xl:px-20">
      <h1 className="text-[32px] font-semibold">Wishlists</h1>
      {visible.length === 0 && visibleExperiences.length === 0 ? (
        <div className="mt-8">
          <h2 className="text-[22px] font-semibold">Create your first wishlist</h2>
          <p className="mt-2 flex items-center gap-1 text-muted">
            As you search, tap the heart icon <Heart className="inline h-4 w-4" /> to save your favourite places.
          </p>
          <Link href="/" className="mt-6 inline-block rounded-lg bg-ink px-6 py-3 font-semibold text-white">
            Start exploring
          </Link>
        </div>
      ) : (
        <>
          {visible.length > 0 && (
            <section>
              <p className="mt-2 text-muted">{visible.length} saved</p>
              <div className="mt-8 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visible.map((l) => (
                  <ListingCard key={l.id} listing={l} />
                ))}
              </div>
            </section>
          )}
          {visibleExperiences.length > 0 && (
            <section className="mt-12">
              <h2 className="text-[22px] font-semibold">Experiences &amp; services</h2>
              <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                {visibleExperiences.map((e) => (
                  <ExperienceCard key={e.id} experience={e} badge="none" showMeta />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
