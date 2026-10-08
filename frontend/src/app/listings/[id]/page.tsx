"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Award, ChevronDown, DoorOpen, Grip, Heart, MapPin, Medal, Share, Star } from "lucide-react";
import DateRangeCalendar from "@/components/DateRangeCalendar";
import { Avatar, BrandButton, Counter, Modal, RatingStar, SafeImage, Spinner } from "@/components/ui";
import MessageButton from "@/components/MessageButton";
import PriceBreakdown from "@/components/PriceBreakdown";
import { useApp } from "@/context/AppProvider";
import { api } from "@/lib/api";
import { amenityIcon } from "@/lib/icons";
import { formatLongDate, formatPrice, formatShortDate, nightsBetween, plural, rangeIsFree, yearsSince, guestsParam, validStayParams } from "@/lib/format";
import type { ListingDetail, Quote, Review } from "@/lib/types";

export default function ListingPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ListingView />
    </Suspense>
  );
}

function ListingView() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { user, wishlistIds, toggleWishlist, toast } = useApp();

  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [notFound, setNotFound] = useState(false);
  // a shared or bookmarked link can carry past or malformed dates: start without them
  const [initialDates] = useState(() => validStayParams(params.get("check_in"), params.get("check_out")));
  const [checkIn, setCheckIn] = useState<string | null>(initialDates[0]);
  const [checkOut, setCheckOut] = useState<string | null>(initialDates[1]);
  const [guests, setGuests] = useState(() => guestsParam(params.get("guests")));
  const [quote, setQuote] = useState<Quote | null>(null);
  const [showPhotos, setShowPhotos] = useState(false);
  const [showAmenities, setShowAmenities] = useState(false);
  const [showReviews, setShowReviews] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const listingId = Number(id);
    api
      .listing(listingId)
      .then((l) => {
        setListing(l);
        setGuests((g) => Math.min(g, l.max_guests)); // ?guests= from a search can exceed this place
      })
      .catch(() => setNotFound(true));
    api.reviews(listingId).then(setReviews).catch(() => {});
  }, [id]);

  // drop prefilled dates that clash with existing bookings
  useEffect(() => {
    if (listing && checkIn && checkOut && !rangeIsFree(checkIn, checkOut, listing.booked_ranges)) {
      setCheckIn(null);
      setCheckOut(null);
    }
  }, [listing, checkIn, checkOut]);

  // live price quote from the server (single source of truth for pricing)
  useEffect(() => {
    setQuote(null);
    if (!listing || !checkIn || !checkOut) return;
    let stale = false; // quick date changes: only the latest answer counts
    api
      .quote(listing.id, checkIn, checkOut, Math.min(guests, listing.max_guests))
      .then((q) => !stale && setQuote(q))
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [listing, checkIn, checkOut, guests]);

  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;
  const saved = listing ? wishlistIds.has(listing.id) : false;

  const ratingBreakdown = useMemo(() => {
    const counts = [5, 4, 3, 2, 1].map((s) => reviews.filter((r) => r.rating === s).length);
    return counts;
  }, [reviews]);

  if (notFound)
    return (
      <div className="py-32 text-center">
        <h1 className="text-3xl font-semibold">This listing isn&apos;t available</h1>
        <Link href="/" className="mt-4 inline-block font-semibold underline">Explore other homes</Link>
      </div>
    );
  if (!listing) return <Spinner />;

  const isOwner = user?.id === listing.host.id;
  const reserve = () => {
    if (isOwner) {
      toast("This is your listing. Switch to a guest account to book it.", "info");
      return;
    }
    if (!checkIn || !checkOut) {
      calendarRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      toast("Add your travel dates to see the total", "info");
      return;
    }
    if (quote && !quote.available) {
      toast("Those dates are not available", "error");
      return;
    }
    router.push(`/book/${listing.id}?check_in=${checkIn}&check_out=${checkOut}&guests=${guests}`);
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("Link copied", "success", listing.photos[0]);
    } catch {
      toast("Couldn't copy the link", "error");
    }
  };

  const location = [listing.city, listing.state, listing.country].filter(Boolean).join(", ");
  const photos = listing.photos;

  return (
    <div className="mx-auto max-w-[1120px] px-6 pb-16 pt-6 md:px-10">
      {/* title row */}
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-[26px] font-semibold leading-8">{listing.title}</h1>
        <div className="hidden shrink-0 gap-2 text-sm font-semibold md:flex">
          <button onClick={share} className="flex items-center gap-2 rounded-lg px-3 py-2 underline hover:bg-soft">
            <Share className="h-4 w-4" /> Share
          </button>
          <button
            onClick={() => toggleWishlist(listing.id, { image: photos[0] })}
            className="flex items-center gap-2 rounded-lg px-3 py-2 underline hover:bg-soft"
          >
            <Heart className={`h-4 w-4 ${saved ? "fill-brand stroke-brand" : ""}`} /> {saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      {/* photo grid */}
      <div className="relative mt-6 grid h-[300px] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-xl md:h-[420px]">
        {photos.slice(0, 5).map((src, i) => (
          <button
            key={i}
            onClick={() => setShowPhotos(true)}
            className={`group relative overflow-hidden bg-soft ${i === 0 ? "col-span-4 row-span-2 md:col-span-2" : "hidden md:block"}`}
          >
            <SafeImage src={src} seed={`${listing.id}-${i}`} alt={`${listing.title} photo ${i + 1}`} className="h-full w-full object-cover transition group-hover:brightness-90" />
          </button>
        ))}
        <button
          onClick={() => setShowPhotos(true)}
          className="absolute bottom-6 right-6 flex items-center gap-2 rounded-lg border border-ink bg-white px-4 py-1.5 text-sm font-semibold hover:bg-soft"
        >
          <Grip className="h-4 w-4" /> Show all photos
        </button>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-16 md:grid-cols-[1fr_380px] lg:gap-24">
        {/* LEFT column */}
        <div>
          <section className="border-b border-line pb-8">
            <h2 className="text-[22px] font-semibold">
              Entire {listing.property_type.toLowerCase()} in {listing.city}, {listing.country}
            </h2>
            <p className="mt-1">
              {plural(listing.max_guests, "guest")} · {plural(listing.bedrooms, "bedroom")} · {plural(listing.beds, "bed")} ·{" "}
              {plural(listing.bathrooms, "bath")}
            </p>
            {listing.rating && (listing.rating ?? 0) >= 4.85 && listing.review_count >= 3 ? (
              <div className="mt-6 flex items-center rounded-xl border border-line px-6 py-4">
                <div className="flex items-center gap-1 text-center font-semibold leading-tight">
                  <Award className="h-7 w-7" /> Guest
                  <br />
                  favourite
                </div>
                <p className="mx-6 hidden flex-1 text-sm font-semibold sm:block">One of the most loved homes on Airbnb, according to guests</p>
                <div className="border-l border-line px-5 text-center">
                  <p className="text-lg font-semibold">{listing.rating.toFixed(2)}</p>
                  <div className="flex">{Array.from({ length: 5 }).map((_, i) => <RatingStar key={i} className="h-2.5 w-2.5" />)}</div>
                </div>
                <button onClick={() => setShowReviews(true)} className="border-l border-line pl-5 text-center">
                  <p className="text-lg font-semibold">{listing.review_count}</p>
                  <p className="text-xs underline">Reviews</p>
                </button>
              </div>
            ) : (
              <p className="mt-2 flex items-center gap-1 font-semibold">
                <RatingStar /> {listing.rating ? listing.rating.toFixed(2) : "New"}
                {listing.review_count > 0 && (
                  <button onClick={() => setShowReviews(true)} className="underline">· {plural(listing.review_count, "review")}</button>
                )}
              </p>
            )}
          </section>

          <section className="flex items-center gap-5 border-b border-line py-6">
            <div className="relative">
              <Avatar src={listing.host.avatar_url} name={listing.host.name} size={44} />
              {listing.host.is_superhost && (
                <Medal className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-white fill-brand stroke-white p-0.5" />
              )}
            </div>
            <div>
              <p className="font-semibold">Hosted by {listing.host.name.split(" ")[0]}</p>
              <p className="text-sm text-muted">
                {listing.host.is_superhost ? "Superhost · " : ""}
                {plural(yearsSince(listing.host.created_at), "year")} hosting
              </p>
            </div>
          </section>

          <section className="space-y-6 border-b border-line py-8">
            {listing.host.is_superhost && (
              <Highlight icon={<Medal className="h-6 w-6" />} title={`${listing.host.name.split(" ")[0]} is a Superhost`} text="Superhosts are experienced, highly rated hosts." />
            )}
            <Highlight icon={<DoorOpen className="h-6 w-6" />} title="Self check-in" text="Check yourself in with the keypad." />
            <Highlight icon={<MapPin className="h-6 w-6" />} title="Great location" text={`Guests love the location in ${listing.city}.`} />
          </section>

          <section className="border-b border-line py-8">
            <p className={`whitespace-pre-line leading-6 ${showDescription ? "" : "line-clamp-6"}`}>{listing.description}</p>
            <button onClick={() => setShowDescription((s) => !s)} className="mt-4 flex items-center gap-1 font-semibold underline">
              {showDescription ? "Show less" : "Show more"} <ChevronDown className={`h-4 w-4 ${showDescription ? "rotate-180" : ""}`} />
            </button>
          </section>

          <section className="border-b border-line py-10">
            <h2 className="text-[22px] font-semibold">What this place offers</h2>
            <div className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              {listing.amenities.slice(0, 10).map((a) => {
                const Icon = amenityIcon(a.icon);
                return (
                  <div key={a.id} className="flex items-center gap-4">
                    <Icon className="h-6 w-6" strokeWidth={1.5} /> {a.name}
                  </div>
                );
              })}
            </div>
            {listing.amenities.length > 10 && (
              <button onClick={() => setShowAmenities(true)} className="mt-8 rounded-lg border border-ink px-6 py-3 font-semibold hover:bg-soft">
                Show all {listing.amenities.length} amenities
              </button>
            )}
          </section>

          <section ref={calendarRef} className="py-10">
            <h2 className="text-[22px] font-semibold">
              {checkIn && checkOut ? `${plural(nights, "night")} in ${listing.city}` : checkIn ? "Select checkout date" : "Select check-in date"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {checkIn && checkOut ? `${formatShortDate(checkIn)} – ${formatShortDate(checkOut)}` : "Add your travel dates for exact pricing"}
            </p>
            <div className="mt-6 hidden sm:block">
              <DateRangeCalendar checkIn={checkIn} checkOut={checkOut} onChange={(a, b) => { setCheckIn(a); setCheckOut(b); }} bookedRanges={listing.booked_ranges} />
            </div>
            <div className="mt-6 sm:hidden">
              <DateRangeCalendar checkIn={checkIn} checkOut={checkOut} onChange={(a, b) => { setCheckIn(a); setCheckOut(b); }} bookedRanges={listing.booked_ranges} months={1} />
            </div>
            {(checkIn || checkOut) && (
              <div className="mt-2 text-right">
                <button className="text-sm font-semibold underline" onClick={() => { setCheckIn(null); setCheckOut(null); }}>
                  Clear dates
                </button>
              </div>
            )}
          </section>
        </div>

        {/* RIGHT column: sticky reservation card */}
        <div className="hidden md:block">
          <div className="sticky top-8 rounded-xl border border-line p-6 shadow-card">
            <p className="text-[22px]">
              {quote ? (
                <>
                  <span className="font-semibold underline">{formatPrice(quote.subtotal)}</span>
                  <span className="text-base"> for {plural(quote.nights, "night")}</span>
                </>
              ) : (
                <>
                  <span className="font-semibold">{formatPrice(listing.price_per_night)}</span>
                  <span className="text-base"> night</span>
                </>
              )}
            </p>
            <ReservationFields
              checkIn={checkIn}
              checkOut={checkOut}
              guests={guests}
              maxGuests={listing.max_guests}
              onGuests={setGuests}
              onEditDates={() => calendarRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
            />
            <BrandButton onClick={reserve} className="mt-4 w-full">
              {checkIn && checkOut ? "Reserve" : "Check availability"}
            </BrandButton>
            {quote && (
              <>
                <p className="mt-3 text-center text-sm">You won&apos;t be charged yet</p>
                {!quote.available && <p className="mt-2 text-center text-sm font-semibold text-brand">Those dates are not available</p>}
                <PriceBreakdown quote={quote} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* reviews */}
      <section className="border-t border-line py-12">
        {reviews.length === 0 ? (
          <h2 className="text-[22px] font-semibold">No reviews (yet)</h2>
        ) : (
          <>
            <h2 className="flex items-center gap-2 text-[22px] font-semibold">
              <Star className="h-5 w-5 fill-current" /> {listing.rating?.toFixed(2)} · {plural(listing.review_count, "review")}
            </h2>
            <div className="mt-6 max-w-sm space-y-1">
              {ratingBreakdown.map((count, i) => (
                <div key={i} className="flex items-center gap-3 text-xs">
                  <span className="w-2">{5 - i}</span>
                  <div className="h-1 flex-1 rounded bg-line">
                    <div className="h-1 rounded bg-ink" style={{ width: `${(count / reviews.length) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-10 grid grid-cols-1 gap-x-24 gap-y-10 md:grid-cols-2">
              {reviews.slice(0, 6).map((r) => (
                <ReviewItem key={r.id} review={r} />
              ))}
            </div>
            {reviews.length > 6 && (
              <button onClick={() => setShowReviews(true)} className="mt-10 rounded-lg border border-ink px-6 py-3 font-semibold hover:bg-soft">
                Show all {reviews.length} reviews
              </button>
            )}
          </>
        )}
      </section>

      {/* map */}
      <section className="border-t border-line py-12">
        <h2 className="text-[22px] font-semibold">Where you&apos;ll be</h2>
        <p className="mt-4">{location}</p>
        <div className="mt-6 h-[420px] overflow-hidden rounded-xl bg-soft">
          <iframe
            title="Map"
            className="h-full w-full"
            loading="lazy"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${listing.longitude - 0.04}%2C${listing.latitude - 0.025}%2C${listing.longitude + 0.04}%2C${listing.latitude + 0.025}&layer=mapnik&marker=${listing.latitude}%2C${listing.longitude}`}
          />
        </div>
      </section>

      {/* host */}
      <section className="border-t border-line py-12">
        <h2 className="text-[22px] font-semibold">Meet your host</h2>
        <div className="mt-6 grid gap-10 md:grid-cols-[360px_1fr]">
          <div className="flex items-center gap-6 rounded-3xl p-8 shadow-[0_6px_20px_rgba(0,0,0,0.2)]">
            <div className="flex flex-1 flex-col items-center text-center">
              <div className="relative">
                <Avatar src={listing.host.avatar_url} name={listing.host.name} size={104} />
                {listing.host.is_superhost && (
                  <Medal className="absolute bottom-0 right-0 h-8 w-8 rounded-full bg-brand stroke-white p-1.5" />
                )}
              </div>
              <p className="mt-3 text-[28px] font-bold leading-8">{listing.host.name.split(" ")[0]}</p>
              <p className="text-sm font-semibold">{listing.host.is_superhost ? "Superhost" : "Host"}</p>
            </div>
            <div className="w-24 divide-y divide-line">
              <Stat value={listing.host.review_count} label="Reviews" />
              <Stat value={listing.host.rating ? `${listing.host.rating.toFixed(2)}★` : "—"} label="Rating" />
              <Stat value={yearsSince(listing.host.created_at)} label="Years hosting" />
            </div>
          </div>
          <div>
            {listing.host.is_superhost && (
              <>
                <p className="font-semibold">{listing.host.name.split(" ")[0]} is a Superhost</p>
                <p className="mt-2 text-muted">Superhosts are experienced, highly rated hosts who are committed to providing great stays for guests.</p>
              </>
            )}
            {listing.host.bio && <p className="mt-6">{listing.host.bio}</p>}
            <p className="mt-6 font-semibold">Host details</p>
            <p className="mt-1 text-muted">Response rate: 100% · Responds within an hour</p>
            {isOwner ? (
              <p className="mt-6 text-sm font-semibold text-muted">This is your listing</p>
            ) : (
              <MessageButton listingType="home" listingId={listing.id} label="Message host" className="mt-6" />
            )}
          </div>
        </div>
      </section>

      {/* mobile reserve bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between border-t border-line bg-white px-6 py-4 md:hidden">
        <div>
          <p className="font-semibold">
            {quote ? formatPrice(quote.total) : formatPrice(listing.price_per_night)}{" "}
            <span className="font-normal">{quote ? "total" : "night"}</span>
          </p>
          <p className="text-sm underline">{checkIn && checkOut ? `${formatShortDate(checkIn)} – ${formatShortDate(checkOut)}` : "Add dates"}</p>
        </div>
        <BrandButton onClick={reserve}>Reserve</BrandButton>
      </div>

      {/* modals */}
      <Modal open={showPhotos} onClose={() => setShowPhotos(false)} title="Photo tour" wide>
        <div className="grid grid-cols-2 gap-2">
          {photos.map((src, i) => (
            <SafeImage key={i} src={src} seed={`${listing.id}-${i}`} alt="" className={`w-full object-cover ${i % 3 === 0 ? "col-span-2 h-96" : "h-60"}`} />
          ))}
        </div>
      </Modal>
      <Modal open={showAmenities} onClose={() => setShowAmenities(false)} title="What this place offers">
        <div className="divide-y divide-line">
          {listing.amenities.map((a) => {
            const Icon = amenityIcon(a.icon);
            return (
              <div key={a.id} className="flex items-center gap-4 py-5">
                <Icon className="h-6 w-6" strokeWidth={1.5} /> {a.name}
              </div>
            );
          })}
        </div>
      </Modal>
      <Modal open={showReviews} onClose={() => setShowReviews(false)} title={`${plural(reviews.length, "review")}`} wide>
        <div className="space-y-8">
          {reviews.map((r) => (
            <ReviewItem key={r.id} review={r} full />
          ))}
        </div>
      </Modal>
    </div>
  );
}

function Highlight({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex gap-6">
      <span className="shrink-0">{icon}</span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-muted">{text}</p>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="py-2">
      <p className="text-xl font-bold leading-6">{value}</p>
      <p className="text-[10px] font-semibold">{label}</p>
    </div>
  );
}

function ReviewItem({ review, full }: { review: Review; full?: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar src={review.author.avatar_url} name={review.author.name} size={44} />
        <div>
          <p className="font-semibold">{review.author.name.split(" ")[0]}</p>
          <p className="text-sm text-muted">{formatLongDate(review.created_at.slice(0, 10))}</p>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star key={i} className={`h-2.5 w-2.5 ${i < review.rating ? "fill-ink stroke-ink" : "stroke-gray-300"}`} />
        ))}
      </div>
      <p className={`mt-1 leading-6 ${full ? "" : "line-clamp-3"}`}>{review.comment}</p>
    </div>
  );
}

function ReservationFields({
  checkIn,
  checkOut,
  guests,
  maxGuests,
  onGuests,
  onEditDates,
}: {
  checkIn: string | null;
  checkOut: string | null;
  guests: number;
  maxGuests: number;
  onGuests: (n: number) => void;
  onEditDates: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative mt-6 rounded-lg border border-gray-400">
      <button onClick={onEditDates} className="grid w-full grid-cols-2 text-left">
        <span className="border-r border-gray-400 px-3 py-2.5">
          <span className="block text-[10px] font-bold uppercase">Check-in</span>
          <span className="text-sm">{checkIn ? formatShortDate(checkIn) : "Add date"}</span>
        </span>
        <span className="px-3 py-2.5">
          <span className="block text-[10px] font-bold uppercase">Checkout</span>
          <span className="text-sm">{checkOut ? formatShortDate(checkOut) : "Add date"}</span>
        </span>
      </button>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between border-t border-gray-400 px-3 py-2.5 text-left">
        <span>
          <span className="block text-[10px] font-bold uppercase">Guests</span>
          <span className="text-sm">{plural(guests, "guest")}</span>
        </span>
        <ChevronDown className={`h-5 w-5 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 rounded-lg bg-white p-4 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">Guests</p>
              <p className="text-sm text-muted">Up to {maxGuests}</p>
            </div>
            <Counter value={guests} onChange={onGuests} min={1} max={maxGuests} />
          </div>
          <p className="mt-3 text-xs text-muted">This place has a maximum of {plural(maxGuests, "guest")}, not including infants.</p>
          <div className="mt-3 text-right">
            <button onClick={() => setOpen(false)} className="font-semibold underline">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
