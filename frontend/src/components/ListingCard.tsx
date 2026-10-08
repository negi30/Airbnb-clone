"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Heart } from "lucide-react";
import { SafeImage, RatingStar } from "./ui";
import { useApp } from "@/context/AppProvider";
import { formatPrice, formatRange, nightsBetween } from "@/lib/format";
import type { ListingCard as Listing } from "@/lib/types";

export function HeartButton({ listing, className = "" }: { listing: Listing; className?: string }) {
  const { wishlistIds, toggleWishlist } = useApp();
  const saved = wishlistIds.has(listing.id);
  return (
    <button
      aria-label={saved ? "Remove from wishlist" : "Save to wishlist"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleWishlist(listing.id, { image: listing.photos[0] });
      }}
      className={`transition active:scale-90 ${className}`}
    >
      <Heart
        className={`h-6 w-6 stroke-white stroke-[2.5] drop-shadow ${saved ? "fill-brand" : "fill-black/50"}`}
      />
    </button>
  );
}

export default function ListingCard({
  listing,
  checkIn,
  checkOut,
  guests,
}: {
  listing: Listing;
  checkIn?: string | null;
  checkOut?: string | null;
  guests?: string | null;
}) {
  const [index, setIndex] = useState(0);
  const photos = listing.photos.length ? listing.photos : [""];
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;
  const guestFavourite = (listing.rating ?? 0) >= 4.85 && listing.review_count >= 3;

  const go = (e: React.MouseEvent, dir: 1 | -1) => {
    e.preventDefault();
    e.stopPropagation();
    setIndex((i) => (i + dir + photos.length) % photos.length);
  };

  // carry the search (dates, party size) over to the listing page
  const query = new URLSearchParams();
  if (checkIn && checkOut) {
    query.set("check_in", checkIn);
    query.set("check_out", checkOut);
  }
  if (guests) query.set("guests", guests);
  const qs = query.toString();
  const href = `/listings/${listing.id}${qs ? `?${qs}` : ""}`;

  return (
    <Link href={href} className="group block">
      <div className="relative aspect-[20/19] overflow-hidden rounded-xl bg-soft">
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {photos.map((src, i) => (
            <SafeImage
              key={i}
              src={src}
              seed={`${listing.id}-${i}`}
              alt={listing.title}
              className="h-full w-full shrink-0 object-cover"
            />
          ))}
        </div>

        {guestFavourite && (
          <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1 text-[13px] font-semibold shadow-sm">
            Guest favourite
          </span>
        )}
        <HeartButton listing={listing} className="absolute right-3 top-3" />

        {photos.length > 1 && (
          <>
            {index > 0 && (
              <button
                aria-label="Previous photo"
                onClick={(e) => go(e, -1)}
                className="absolute left-3 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow transition hover:scale-105 group-hover:flex"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {index < photos.length - 1 && (
              <button
                aria-label="Next photo"
                onClick={(e) => go(e, 1)}
                className="absolute right-3 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 shadow transition hover:scale-105 group-hover:flex"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1">
              {photos.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 w-1.5 rounded-full transition ${i === index ? "bg-white" : "bg-white/60"}`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="mt-3 text-[15px] leading-5">
        <div className="flex justify-between gap-2">
          <p className="truncate font-semibold">
            {listing.city}, {listing.country}
          </p>
          {listing.rating ? (
            <span className="flex shrink-0 items-center gap-1">
              <RatingStar />
              {listing.rating.toFixed(2)}
            </span>
          ) : (
            <span className="shrink-0">New</span>
          )}
        </div>
        <p className="truncate text-muted">{listing.title}</p>
        <p className="truncate text-muted">
          {checkIn && checkOut ? formatRange(checkIn, checkOut) : `${listing.bedrooms} bedroom${listing.bedrooms === 1 ? "" : "s"} · ${listing.beds} bed${listing.beds === 1 ? "" : "s"}`}
        </p>
        <p className="mt-1.5">
          {nights > 0 ? (
            <>
              <span className="font-semibold underline">{formatPrice(listing.price_per_night * nights)}</span>
              <span> for {nights} night{nights > 1 ? "s" : ""}</span>
            </>
          ) : (
            <>
              <span className="font-semibold">{formatPrice(listing.price_per_night)}</span>
              <span> night</span>
            </>
          )}
        </p>
      </div>
    </Link>
  );
}

export function ListingCardSkeleton() {
  return (
    <div>
      <div className="skeleton aspect-[20/19] rounded-xl" />
      <div className="skeleton mt-3 h-4 w-3/4 rounded" />
      <div className="skeleton mt-2 h-4 w-1/2 rounded" />
      <div className="skeleton mt-2 h-4 w-1/3 rounded" />
    </div>
  );
}
