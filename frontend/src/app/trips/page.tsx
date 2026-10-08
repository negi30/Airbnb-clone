"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Star, X } from "lucide-react";
import { Modal, SafeImage, Spinner } from "@/components/ui";
import { useApp } from "@/context/AppProvider";
import { api } from "@/lib/api";
import { experienceHref } from "@/components/ExperienceCard";
import MessageButton from "@/components/MessageButton";
import { formatPrice, formatRange, formatSlotDay, formatTimeRange, plural, todayISO } from "@/lib/format";
import type { Booking, CancelledBy, ExperienceBooking, ListingType } from "@/lib/types";

interface ReviewTarget {
  title: string;
  subtitle: string;
  image?: string;
  heading: string;
  submit: (rating: number, comment: string) => Promise<unknown>;
}

type TripTab = "all" | "upcoming" | "past" | "cancelled";
const TRIP_TABS: [TripTab, string][] = [
  ["all", "All trips"],
  ["upcoming", "Upcoming"],
  ["past", "Past"],
  ["cancelled", "Cancelled"],
];

/** Stays and experience/service bookings share one cancelled-card layout. */
interface CancelledTrip {
  key: string;
  listingType: ListingType;
  reservationId: number;
  href: string;
  image: string;
  seed: string;
  kind: string;
  place: string;
  title: string;
  hostName: string;
  when: string;
  guests: number;
  total: number;
  cancelledBy: CancelledBy | null;
  cancelledAt: string | null;
  searchAgain: string;
}

const TAB_IDS = TRIP_TABS.map(([t]) => t);

/** Host cancellations the guest has already acknowledged, per account, so the alert doesn't nag forever. */
const seenKey = (userId: number) => `airbnb-clone:seen-host-cancellations:${userId}`;
function readSeen(userId: number): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(seenKey(userId)) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function writeSeen(userId: number, keys: Set<string>) {
  try {
    window.localStorage.setItem(seenKey(userId), JSON.stringify([...keys]));
  } catch {
    /* storage blocked: the alert just comes back next visit */
  }
}

export default function TripsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Trips />
    </Suspense>
  );
}

function Trips() {
  const { user, toast } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [trips, setTrips] = useState<Booking[] | null>(null);
  const [expTrips, setExpTrips] = useState<ExperienceBooking[] | null>(null);
  const [reviewing, setReviewing] = useState<ReviewTarget | null>(null);
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const [cancellingExp, setCancellingExp] = useState<ExperienceBooking | null>(null);
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  // tab lives in the URL so refresh / back keep it
  const tab: TripTab = TAB_IDS.includes(params.get("tab") as TripTab) ? (params.get("tab") as TripTab) : "all";
  const setTab = (t: TripTab) => router.replace(t === "all" ? pathname : `${pathname}?tab=${t}`, { scroll: false });

  // answers from a previous load (e.g. the account before a switch) are ignored
  const loadId = useRef(0);
  const load = useCallback(() => {
    const id = ++loadId.current;
    const latest = () => id === loadId.current;
    api.myTrips().then((t) => latest() && setTrips(t)).catch(() => latest() && setTrips([]));
    api.myExperienceBookings().then((t) => latest() && setExpTrips(t)).catch(() => latest() && setExpTrips([]));
  }, []);

  useEffect(() => {
    if (!user) return;
    // drop the previous account's trips so they never flash under the new one
    setTrips(null);
    setExpTrips(null);
    setSeen(readSeen(user.id));
    load();
  }, [user, load]);

  if (!trips || !expTrips) return <Spinner />;

  const today = todayISO();
  const now = new Date();
  const upcoming = trips.filter((t) => t.status === "confirmed" && t.check_out > today).reverse();
  const past = trips.filter((t) => t.status === "confirmed" && t.check_out <= today);
  const cancelled = trips.filter((t) => t.status === "cancelled");
  const expUpcoming = expTrips.filter((t) => t.status === "confirmed" && new Date(t.slot.ends_at) > now).reverse();
  const expPast = expTrips.filter((t) => t.status === "confirmed" && new Date(t.slot.ends_at) <= now);
  const expCancelled = expTrips.filter((t) => t.status === "cancelled");

  const reviewStay = (b: Booking) =>
    setReviewing({
      heading: "How was your stay?",
      title: b.listing.title,
      subtitle: formatRange(b.check_in, b.check_out),
      image: b.listing.photos[0],
      submit: (rating, comment) => api.createReview(b.listing.id, { booking_id: b.id, rating, comment }),
    });
  const reviewExperience = (b: ExperienceBooking) =>
    setReviewing({
      heading: `How was your ${b.experience.kind}?`,
      title: b.experience.title,
      subtitle: `${formatSlotDay(b.slot.starts_at)} · ${formatTimeRange(b.slot.starts_at, b.slot.ends_at)}`,
      image: b.experience.photos[0],
      submit: (rating, comment) => api.createExperienceReview(b.experience.id, { booking_id: b.id, rating, comment }),
    });

  const cancelExperience = async (b: ExperienceBooking) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.cancelExperienceBooking(b.id);
      toast("Booking cancelled — your spot has been released", "success", b.experience.photos[0]);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't cancel", "error");
    } finally {
      setBusy(false);
      setCancellingExp(null);
    }
  };

  const cancel = async (b: Booking) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.cancelBooking(b.id);
      toast("Reservation cancelled — those dates are free again", "success", b.listing.photos[0]);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't cancel", "error");
    } finally {
      setBusy(false);
      setCancelling(null);
    }
  };

  const cancelledCards: CancelledTrip[] = [
    ...cancelled.map((b) => ({
      key: `home-${b.id}`,
      listingType: "home" as const,
      reservationId: b.id,
      href: `/listings/${b.listing.id}`,
      image: b.listing.photos[0] ?? "",
      seed: `${b.listing.id}-0`,
      kind: "Stay",
      place: b.listing.city,
      title: b.listing.title,
      hostName: b.listing.host_name,
      when: formatRange(b.check_in, b.check_out),
      guests: b.guests,
      total: b.total_price,
      cancelledBy: b.cancelled_by,
      cancelledAt: b.cancelled_at,
      searchAgain: `/?location=${encodeURIComponent(b.listing.city)}&check_in=${b.check_in}&check_out=${b.check_out}&guests=${b.guests}`,
    })),
    ...expCancelled.map((b) => ({
      key: `exp-${b.id}`,
      listingType: b.experience.kind,
      reservationId: b.id,
      href: experienceHref(b.experience),
      image: b.experience.photos[0] ?? "",
      seed: `exp-${b.experience.id}-0`,
      kind: b.experience.kind === "service" ? "Service" : "Experience",
      place: b.experience.city,
      title: b.experience.title,
      hostName: b.experience.host_name,
      when: `${formatSlotDay(b.slot.starts_at)} · ${formatTimeRange(b.slot.starts_at, b.slot.ends_at)}`,
      guests: b.guests,
      total: b.total_price,
      cancelledBy: b.cancelled_by,
      cancelledAt: b.cancelled_at,
      searchAgain: `${b.experience.kind === "service" ? "/services" : "/experiences"}?location=${encodeURIComponent(b.experience.city)}`,
    })),
  ].sort((a, b) => (b.cancelledAt ?? "").localeCompare(a.cancelledAt ?? ""));
  // a host cancellation is news to the guest, so surface recent ones above everything else
  // only ones the guest hasn't acknowledged yet (View, dismiss, or opening the Cancelled tab)
  const hostCancelled = cancelledCards.filter((c) => c.cancelledBy === "host" && !seen.has(c.key));
  const acknowledge = () => {
    if (!user || hostCancelled.length === 0) return;
    const next = new Set(seen);
    hostCancelled.forEach((c) => next.add(c.key));
    writeSeen(user.id, next);
    setSeen(next);
  };
  const openTab = (t: TripTab) => {
    if (t === "cancelled") acknowledge();
    setTab(t);
  };

  const counts: Record<TripTab, number> = {
    all: trips.length + expTrips.length,
    upcoming: upcoming.length + expUpcoming.length,
    past: past.length + expPast.length,
    cancelled: cancelledCards.length,
  };
  const show = (t: TripTab) => tab === "all" || tab === t;

  return (
    <div className="mx-auto max-w-[1120px] px-6 py-10 md:px-10">
      <h1 className="text-[32px] font-semibold">Trips</h1>

      <div className="no-scrollbar mt-6 flex gap-2 overflow-x-auto">
        {TRIP_TABS.map(([t, label]) => (
          <button
            key={t}
            onClick={() => openTab(t)}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition ${
              tab === t ? "border-ink bg-ink text-white" : "border-line hover:border-ink"
            }`}
          >
            {label} ({counts[t]})
          </button>
        ))}
      </div>

      {hostCancelled.length > 0 && tab !== "cancelled" && (
        <div role="status" className="mt-6 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
          <p className="flex-1">
            {hostCancelled.length === 1 ? (
              <>Your host <b>{hostCancelled[0].hostName}</b> cancelled your {hostCancelled[0].kind.toLowerCase()} in {hostCancelled[0].place}. </>
            ) : (
              <>{hostCancelled.length} of your reservations were cancelled by their hosts. </>
            )}
            A full refund has been initiated.
          </p>
          <button onClick={() => openTab("cancelled")} className="shrink-0 font-semibold underline">View</button>
          <button onClick={acknowledge} aria-label="Dismiss" className="-m-1 shrink-0 rounded-full p-1 hover:bg-rose-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {show("upcoming") && upcoming.length === 0 && expUpcoming.length === 0 && (
        <div className="mt-8 border-b border-line pb-12">
          <h2 className="text-[22px] font-semibold">No trips booked… yet!</h2>
          <p className="mt-2 text-muted">Time to dust off your bags and start planning your next adventure.</p>
          <Link href="/" className="mt-6 inline-block rounded-lg border border-ink px-6 py-3 font-semibold hover:bg-soft">
            Start searching
          </Link>
        </div>
      )}

      {show("upcoming") && upcoming.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[22px] font-semibold">Upcoming reservations</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {upcoming.map((b) => (
              <div key={b.id} className="overflow-hidden rounded-2xl border border-line shadow-sm">
                <Link href={`/listings/${b.listing.id}`}>
                  <SafeImage src={b.listing.photos[0]} seed={`${b.listing.id}-0`} alt="" className="h-52 w-full object-cover" />
                </Link>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-lg font-semibold">{b.listing.city}</p>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Confirmed</span>
                  </div>
                  <p className="text-sm text-muted">{b.listing.title} · Hosted by {b.listing.host_name}</p>
                  <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4 text-sm">
                    <div>
                      <p className="font-semibold">Dates</p>
                      <p>{formatRange(b.check_in, b.check_out)}</p>
                    </div>
                    <div>
                      <p className="font-semibold">Guests</p>
                      <p>{plural(b.guests, "guest")}</p>
                    </div>
                    <div>
                      <p className="font-semibold">Total</p>
                      <p>{formatPrice(b.total_price)}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                    <MessageButton variant="link" listingType="home" reservationId={b.id} label="Message host" />
                    {b.check_in > today && (
                      <button onClick={() => setCancelling(b)} className="text-sm font-semibold underline">
                        Cancel reservation
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {show("upcoming") && expUpcoming.length > 0 && (
        <section className="mt-12">
          <h2 className="text-[22px] font-semibold">Upcoming experiences &amp; services</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {expUpcoming.map((b) => (
              <div key={b.id} className="flex overflow-hidden rounded-2xl border border-line shadow-sm">
                <Link href={experienceHref(b.experience)} className="w-36 shrink-0 sm:w-44">
                  <SafeImage src={b.experience.photos[0] ?? ""} seed={`exp-${b.experience.id}-0`} alt="" className="h-full w-full object-cover" />
                </Link>
                <div className="min-w-0 flex-1 p-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">{b.experience.kind} · {b.experience.city}</p>
                  <Link href={experienceHref(b.experience)} className="mt-1 line-clamp-2 font-semibold hover:underline">
                    {b.experience.title}
                  </Link>
                  <p className="mt-2 text-sm">{formatSlotDay(b.slot.starts_at)}</p>
                  <p className="text-sm text-muted">{formatTimeRange(b.slot.starts_at, b.slot.ends_at)}</p>
                  <p className="mt-2 text-sm">
                    {plural(b.guests, "guest")} · {formatPrice(b.total_price)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                    <MessageButton variant="link" listingType={b.experience.kind} reservationId={b.id} label="Message host" />
                    {new Date(b.slot.starts_at) > now ? (
                      <button onClick={() => setCancellingExp(b)} className="text-sm font-semibold underline">
                        Cancel booking
                      </button>
                    ) : (
                      <p className="text-sm font-semibold text-amber-700">Happening now</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {show("past") && past.length === 0 && expPast.length === 0 && tab === "past" && (
        <p className="py-16 text-center text-muted">No past trips yet.</p>
      )}

      {show("past") && past.length > 0 && (
        <section className="mt-12">
          <h2 className="text-[22px] font-semibold">Where you&apos;ve been</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {past.map((b) => (
              <div key={b.id} className="flex gap-4">
                <Link href={`/listings/${b.listing.id}`} className="shrink-0">
                  <SafeImage src={b.listing.photos[0]} seed={`${b.listing.id}-0`} alt="" className="h-24 w-24 rounded-xl object-cover" />
                </Link>
                <div className="min-w-0">
                  <p className="font-semibold">{b.listing.city}</p>
                  <p className="truncate text-sm text-muted">Hosted by {b.listing.host_name}</p>
                  <p className="text-sm text-muted">{formatRange(b.check_in, b.check_out)}</p>
                  <div className="mt-1 flex flex-wrap gap-x-4">
                    {b.has_review ? (
                      <p className="text-sm text-muted">Reviewed ✓</p>
                    ) : (
                      <button onClick={() => reviewStay(b)} className="text-sm font-semibold underline">
                        Leave a review
                      </button>
                    )}
                    <MessageButton variant="link" listingType="home" reservationId={b.id} label="Message" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {show("past") && expPast.length > 0 && (
        <section className="mt-12">
          <h2 className="text-[22px] font-semibold">Past experiences &amp; services</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {expPast.map((b) => (
              <div key={b.id} className="flex gap-4">
                <Link href={experienceHref(b.experience)} className="shrink-0">
                  <SafeImage src={b.experience.photos[0] ?? ""} seed={`exp-${b.experience.id}-0`} alt="" className="h-24 w-24 rounded-xl object-cover" />
                </Link>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{b.experience.title}</p>
                  <p className="truncate text-sm text-muted">Hosted by {b.experience.host_name}</p>
                  <p className="text-sm text-muted">{formatSlotDay(b.slot.starts_at)}</p>
                  <div className="mt-1 flex flex-wrap gap-x-4">
                    {b.has_review ? (
                      <p className="text-sm text-muted">Rated ✓</p>
                    ) : (
                      <button onClick={() => reviewExperience(b)} className="text-sm font-semibold underline">
                        Leave a rating
                      </button>
                    )}
                    <MessageButton variant="link" listingType={b.experience.kind} reservationId={b.id} label="Message" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {show("cancelled") && tab === "cancelled" && cancelledCards.length === 0 && (
        <p className="py-16 text-center text-muted">No cancelled trips.</p>
      )}

      {show("cancelled") && cancelledCards.length > 0 && (
        <section className="mt-12">
          <h2 className="text-[22px] font-semibold">Cancelled</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {cancelledCards.map((c) => (
              <CancelledCard key={c.key} trip={c} />
            ))}
          </div>
        </section>
      )}

      <Modal
        open={Boolean(cancellingExp)}
        onClose={() => setCancellingExp(null)}
        title="Cancel booking?"
        footer={
          <div className="flex justify-end gap-3">
            <button onClick={() => setCancellingExp(null)} className="rounded-lg px-5 py-3 font-semibold underline">Keep it</button>
            <button disabled={busy} onClick={() => cancellingExp && cancelExperience(cancellingExp)} className="rounded-lg bg-ink px-6 py-3 font-semibold text-white disabled:opacity-50">
              {busy ? "Cancelling…" : "Cancel booking"}
            </button>
          </div>
        }
      >
        {cancellingExp && (
          <p>
            <b>{cancellingExp.experience.title}</b> on {formatSlotDay(cancellingExp.slot.starts_at)} will be cancelled and you&apos;ll get a
            full refund of {formatPrice(cancellingExp.total_price)} (mocked).
          </p>
        )}
      </Modal>

      <Modal
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        title="Cancel reservation?"
        footer={
          <div className="flex justify-end gap-3">
            <button onClick={() => setCancelling(null)} className="rounded-lg px-5 py-3 font-semibold underline">Keep it</button>
            <button disabled={busy} onClick={() => cancelling && cancel(cancelling)} className="rounded-lg bg-ink px-6 py-3 font-semibold text-white disabled:opacity-50">
              {busy ? "Cancelling…" : "Cancel reservation"}
            </button>
          </div>
        }
      >
        {cancelling && (
          <p>
            Your stay at <b>{cancelling.listing.title}</b> ({formatRange(cancelling.check_in, cancelling.check_out)}) will be cancelled and
            you&apos;ll get a full refund of {formatPrice(cancelling.total_price)} (mocked).
          </p>
        )}
      </Modal>

      <ReviewModal
        target={reviewing}
        onClose={() => setReviewing(null)}
        onDone={() => {
          setReviewing(null);
          load();
        }}
      />
    </div>
  );
}

function CancelledCard({ trip }: { trip: CancelledTrip }) {
  const byHost = trip.cancelledBy === "host";
  const on = trip.cancelledAt
    ? new Date(trip.cancelledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : null;
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white">
      <Link href={trip.href} className="relative block">
        {/* muted so the inactive state reads at a glance */}
        <SafeImage src={trip.image} seed={trip.seed} alt="" className="h-44 w-full object-cover opacity-60 grayscale" />
        <span
          className={`absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-semibold shadow-sm ${
            byHost ? "bg-rose-600 text-white" : "bg-white text-ink"
          }`}
        >
          {byHost ? "Cancelled by Host" : "Cancelled by You"}
        </span>
      </Link>
      <div className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{trip.kind} · {trip.place}</p>
        <Link href={trip.href} className="mt-1 line-clamp-1 font-semibold text-muted hover:underline">{trip.title}</Link>
        <p className="text-sm text-muted">Hosted by {trip.hostName}</p>

        {byHost ? (
          <div className="mt-4 flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
            <p>
              Your host <b>{trip.hostName}</b> had to cancel this reservation{on ? ` on ${on}` : ""}. A full refund of{" "}
              <b>{formatPrice(trip.total)}</b> has been initiated.
            </p>
          </div>
        ) : (
          <p className="mt-4 rounded-xl bg-soft p-3 text-sm text-muted">
            You cancelled this{on ? ` on ${on}` : ""}. Your refund of {formatPrice(trip.total)} has been processed (mocked).
          </p>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4 text-sm text-muted">
          <div>
            <p className="font-semibold text-ink/70">When</p>
            <p className="line-through decoration-1">{trip.when}</p>
          </div>
          <div>
            <p className="font-semibold text-ink/70">Guests</p>
            <p>{plural(trip.guests, "guest")}</p>
          </div>
          <div>
            <p className="font-semibold text-ink/70">Refund</p>
            <p>{formatPrice(trip.total)}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          <MessageButton variant="link" listingType={trip.listingType} reservationId={trip.reservationId} label="Message host" />
          {byHost && (
            <Link href={trip.searchAgain} className="text-sm font-semibold underline">
              Find something similar in {trip.place}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewModal({ target, onClose, onDone }: { target: ReviewTarget | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRating(0);
    setHover(0);
    setComment("");
  }, [target]);

  const submit = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await target.submit(rating, comment);
      toast("Thanks for your review!", "success", target.image);
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't post review", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title={target?.heading}
      footer={
        <div className="flex items-center justify-end gap-4">
          {!saving && (!rating || comment.trim().length < 5) && (
            <p className="text-sm text-muted">{!rating ? "Pick a star rating" : "Write a few more words"}</p>
          )}
          <button
            onClick={submit}
            disabled={!rating || comment.trim().length < 5 || saving}
            className="rounded-lg bg-ink px-6 py-3 font-semibold text-white disabled:opacity-40"
          >
            {saving ? "Posting…" : "Post review"}
          </button>
        </div>
      }
    >
      {target && (
        <>
          <p className="font-semibold">{target.title}</p>
          <p className="text-sm text-muted">{target.subtitle}</p>
          <div className="mt-6 flex gap-2" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onMouseEnter={() => setHover(n)} onClick={() => setRating(n)} aria-label={`${n} stars`}>
                <Star className={`h-9 w-9 ${(hover || rating) >= n ? "fill-ink stroke-ink" : "stroke-gray-300"}`} />
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Share what you loved and what could be better"
            rows={5}
            maxLength={2000}
            className="mt-6 w-full rounded-xl border border-gray-400 p-4 outline-none focus:border-ink"
          />
        </>
      )}
    </Modal>
  );
}
