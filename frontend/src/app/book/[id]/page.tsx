"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronLeft, CreditCard } from "lucide-react";
import DateRangeCalendar from "@/components/DateRangeCalendar";
import PriceBreakdown from "@/components/PriceBreakdown";
import { BrandButton, Counter, Modal, RatingStar, SafeImage, Spinner } from "@/components/ui";
import { useApp } from "@/context/AppProvider";
import { api } from "@/lib/api";
import { addDays, formatLongDate, formatRange, formatPrice, plural, guestsParam, validStayParams } from "@/lib/format";
import type { Booking, ListingDetail, Quote } from "@/lib/types";

export default function BookPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Checkout />
    </Suspense>
  );
}

function Checkout() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { user, toast } = useApp();

  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [initialDates] = useState(() => validStayParams(params.get("check_in"), params.get("check_out")));
  const [checkIn, setCheckIn] = useState<string | null>(initialDates[0]);
  const [checkOut, setCheckOut] = useState<string | null>(initialDates[1]);
  const [guests, setGuests] = useState(() => guestsParam(params.get("guests")));
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [editDates, setEditDates] = useState(false);
  const [editGuests, setEditGuests] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [booking, setBooking] = useState<Booking | null>(null);

  useEffect(() => {
    api
      .listing(Number(id))
      .then((l) => {
        setListing(l);
        setGuests((g) => Math.min(g, l.max_guests)); // a stale ?guests= link can exceed the new limit
      })
      .catch(() => router.replace("/"));
  }, [id, router]);

  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!listing || !checkIn || !checkOut) return;
    let stale = false; // only the answer for the current dates/guests counts
    api
      .quote(listing.id, checkIn, checkOut, guests)
      .then((q) => !stale && setQuote(q))
      .catch((e) => !stale && setQuoteError(e instanceof Error ? e.message : "Couldn't price those dates"));
    return () => {
      stale = true;
    };
  }, [listing, checkIn, checkOut, guests]);

  if (!listing) return <Spinner />;

  const confirm = async () => {
    if (!checkIn || !checkOut) return setEditDates(true);
    if (submitting) return;
    setSubmitting(true);
    try {
      const b = await api.createBooking({ listing_id: listing.id, check_in: checkIn, check_out: checkOut, guests });
      setBooking(b);
      toast("Reservation confirmed!", "success", listing.photos[0]);
      window.scrollTo({ top: 0 });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Booking failed", "error");
      // refresh availability in case someone else just booked these dates
      api.listing(listing.id).then(setListing).catch(() => {});
    } finally {
      setSubmitting(false);
    }
  };

  if (booking) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-600" />
        <h1 className="mt-6 text-[32px] font-semibold">Your reservation is confirmed</h1>
        <p className="mt-2 text-muted">
          You&apos;re going to {listing.city}! Confirmation #{String(booking.id).padStart(6, "0")}
        </p>
        <div className="mt-10 overflow-hidden rounded-2xl border border-line text-left">
          <SafeImage src={listing.photos[0]} seed={`${listing.id}-0`} alt="" className="h-56 w-full object-cover" />
          <div className="space-y-2 p-6">
            <p className="text-lg font-semibold">{listing.title}</p>
            <p className="text-muted">
              {formatRange(booking.check_in, booking.check_out)} · {plural(booking.guests, "guest")} · {plural(booking.nights, "night")}
            </p>
            <p className="font-semibold">Total paid (mock): {formatPrice(booking.total_price)}</p>
          </div>
        </div>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/trips" className="rounded-lg bg-ink px-6 py-3 font-semibold text-white">View my trips</Link>
          <Link href="/" className="rounded-lg border border-ink px-6 py-3 font-semibold">Keep exploring</Link>
        </div>
      </div>
    );
  }

  const ownListing = user?.id === listing.host.id;

  return (
    <div className="mx-auto max-w-[1120px] px-6 pb-16 pt-10 md:px-10">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} aria-label="Back" className="rounded-full p-2 hover:bg-soft">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-[32px] font-semibold">Confirm and pay</h1>
      </div>

      <div className="mt-8 grid gap-16 md:grid-cols-[1fr_440px]">
        <div>
          <section className="border-b border-line pb-8">
            <h2 className="text-[22px] font-semibold">Your trip</h2>
            <div className="mt-6 flex items-start justify-between">
              <div>
                <p className="font-semibold">Dates</p>
                <p>{checkIn && checkOut ? formatRange(checkIn, checkOut) : "Add dates"}</p>
              </div>
              <button onClick={() => setEditDates(true)} className="font-semibold underline">Edit</button>
            </div>
            <div className="mt-6 flex items-start justify-between">
              <div>
                <p className="font-semibold">Guests</p>
                <p>{plural(guests, "guest")}</p>
              </div>
              <button onClick={() => setEditGuests(true)} className="font-semibold underline">Edit</button>
            </div>
          </section>

          <section className="border-b border-line py-8">
            <div className="flex items-center justify-between">
              <h2 className="text-[22px] font-semibold">Pay with</h2>
              <span className="rounded bg-soft px-2 py-1 text-xs font-semibold text-muted">DEMO · no real payment</span>
            </div>
            <div className="mt-6 flex items-center gap-4 rounded-lg border border-gray-400 px-4 py-3">
              <CreditCard className="h-6 w-6" />
              <div className="flex-1">
                <p className="font-semibold">Test card •••• 4242</p>
                <p className="text-sm text-muted">Payments are mocked in this clone</p>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted">UPI, net banking and split payments: coming soon.</p>
          </section>

          <section className="border-b border-line py-8">
            <h2 className="text-[22px] font-semibold">Cancellation policy</h2>
            <p className="mt-4">
              <span className="font-semibold">Free cancellation before {checkIn ? formatLongDate(addDays(checkIn, -1)) : "check-in"}.</span>{" "}
              Cancel from <Link href="/trips" className="underline">My trips</Link> any time before your stay starts.
            </p>
          </section>

          <section className="border-b border-line py-8">
            <h2 className="text-[22px] font-semibold">Ground rules</h2>
            <p className="mt-4">We ask every guest to remember a few simple things about what makes a great guest.</p>
            <ul className="mt-3 list-disc pl-5">
              <li>Follow the house rules</li>
              <li>Treat your Host&apos;s home like your own</li>
            </ul>
          </section>

          <p className="py-8 text-xs text-muted">
            By selecting the button below, I agree to the Host&apos;s House Rules and the Airbnb Rebooking and Refund Policy.
          </p>
          {ownListing && <p className="mb-4 text-sm font-semibold text-brand">You&apos;re signed in as this listing&apos;s host. Switch to a guest account to book.</p>}
          {quoteError && <p className="mb-4 text-sm font-semibold text-brand">{quoteError}</p>}
          {quote && !quote.available && <p className="mb-4 text-sm font-semibold text-brand">Those dates are no longer available — pick new dates.</p>}
          <BrandButton onClick={confirm} disabled={submitting || !quote || !quote.available || ownListing} className="w-full md:w-auto md:px-10">
            {submitting ? "Confirming…" : "Confirm and pay"}
          </BrandButton>
        </div>

        <aside>
          <div className="sticky top-8 rounded-xl border border-line p-6">
            <div className="flex gap-4 border-b border-line pb-6">
              <SafeImage src={listing.photos[0]} seed={`${listing.id}-0`} alt="" className="h-24 w-28 shrink-0 rounded-lg object-cover" />
              <div className="min-w-0">
                <p className="truncate font-semibold">{listing.title}</p>
                <p className="text-sm text-muted">Entire {listing.property_type.toLowerCase()}</p>
                <p className="mt-2 flex items-center gap-1 text-xs">
                  <RatingStar className="h-3 w-3" /> {listing.rating?.toFixed(2) ?? "New"} ({listing.review_count})
                  {listing.host.is_superhost && " · Superhost"}
                </p>
              </div>
            </div>
            <h3 className="mt-6 text-[22px] font-semibold">Price details</h3>
            {quote ? <PriceBreakdown quote={quote} /> : <p className="mt-4 text-muted">Select dates to see the price.</p>}
          </div>
        </aside>
      </div>

      <Modal
        open={editDates}
        onClose={() => setEditDates(false)}
        title="Edit dates"
        wide
        footer={
          <div className="flex justify-between">
            <button className="font-semibold underline" onClick={() => { setCheckIn(null); setCheckOut(null); }}>Clear dates</button>
            <button disabled={!checkIn || !checkOut} onClick={() => setEditDates(false)} className="rounded-lg bg-ink px-6 py-3 font-semibold text-white disabled:opacity-40">Save</button>
          </div>
        }
      >
        <DateRangeCalendar checkIn={checkIn} checkOut={checkOut} onChange={(a, b) => { setCheckIn(a); setCheckOut(b); }} bookedRanges={listing.booked_ranges} />
      </Modal>
      <Modal
        open={editGuests}
        onClose={() => setEditGuests(false)}
        title="Guests"
        footer={<div className="text-right"><button onClick={() => setEditGuests(false)} className="rounded-lg bg-ink px-6 py-3 font-semibold text-white">Save</button></div>}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold">Guests</p>
            <p className="text-sm text-muted">This place allows up to {listing.max_guests}</p>
          </div>
          <Counter value={guests} onChange={setGuests} min={1} max={listing.max_guests} />
        </div>
      </Modal>
    </div>
  );
}
