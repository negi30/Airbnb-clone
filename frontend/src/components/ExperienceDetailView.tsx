"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ClipboardList, Clock, Copy, Heart, MapPin, Medal, Share, Star } from "lucide-react";
import { ExperienceRow } from "./ExperienceCard";
import { Avatar, BrandButton, Counter, Modal, RatingStar, SafeImage, Spinner } from "./ui";
import MessageButton from "./MessageButton";
import { useApp } from "@/context/AppProvider";
import { api } from "@/lib/api";
import { formatDuration, formatPrice, formatSlotDay, formatTimeRange, plural, yearsSince, guestsParam } from "@/lib/format";
import type { ExperienceCard, ExperienceDetail, ExperienceKind, ExperienceQuote, Review, Slot } from "@/lib/types";

const COPY = {
  experience: { noun: "experience", plural: "experiences", base: "/experiences", activities: "What you'll do", where: "Where we'll meet" },
  service: { noun: "service", plural: "services", base: "/services", activities: "What's offered", where: "Where it happens" },
} as const;

export default function ExperienceDetailView({ kind }: { kind: ExperienceKind }) {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { user, savedExperienceIds, toggleSavedExperience, toast } = useApp();
  const copy = COPY[kind];

  const [exp, setExp] = useState<ExperienceDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [more, setMore] = useState<ExperienceCard[]>([]);
  const [guests, setGuests] = useState(() => guestsParam(params.get("guests")));
  const [selected, setSelected] = useState<Slot | null>(null);
  const [showDates, setShowDates] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [showReviews, setShowReviews] = useState(false);
  const [reloadSlots, setReloadSlots] = useState(0);

  useEffect(() => {
    const expId = Number(id);
    setExp(null);
    api
      .experience(expId)
      .then((e) => {
        // an id from the other tab: send the guest to the right URL
        if (e.kind !== kind) router.replace(`${COPY[e.kind].base}/${e.id}`);
        setExp(e);
        setGuests((g) => Math.min(g, e.max_guests)); // ?guests= from a search can exceed this one
        api
          .searchExperiences({ kind: e.kind, location: e.city, sort: "rating", page_size: 12 })
          .then((r) => setMore(r.items.filter((x) => x.id !== e.id)))
          .catch(() => setMore([]));
      })
      .catch(() => setNotFound(true));
    api.experienceReviews(expId).then(setReviews).catch(() => setReviews([]));
  }, [id, kind, router]);

  useEffect(() => {
    if (!exp) return;
    let stale = false;
    api
      .experienceSlots(exp.id, Math.min(guests, exp.max_guests), 60)
      .then((s) => !stale && setSlots(s))
      .catch(() => !stale && setSlots([]));
    return () => {
      stale = true;
    };
  }, [exp, guests, reloadSlots]);

  const slotsByDay = useMemo(() => {
    const groups = new Map<string, Slot[]>();
    slots?.forEach((s) => groups.set(s.starts_at.slice(0, 10), [...(groups.get(s.starts_at.slice(0, 10)) ?? []), s]));
    return [...groups.entries()];
  }, [slots]);

  if (notFound)
    return (
      <div className="py-32 text-center">
        <h1 className="text-3xl font-semibold">This {copy.noun} isn&apos;t available</h1>
        <Link href={copy.base} className="mt-4 inline-block font-semibold underline">
          Explore other {copy.plural}
        </Link>
      </div>
    );
  if (!exp) return <Spinner />;

  const saved = savedExperienceIds.has(exp.id);
  const isOwn = user?.id === exp.host.id;
  const photos = exp.photos;
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("Link copied", "success", photos[0]);
    } catch {
      toast("Couldn't copy the link", "error");
    }
  };
  const pick = (slot: Slot) => {
    if (isOwn) {
      toast(`You can't book your own ${copy.noun}`, "error");
      return;
    }
    setShowDates(false);
    setSelected(slot);
  };
  const ratingLabel = exp.rating !== null ? exp.rating.toFixed(2) : null;

  return (
    <div className="mx-auto max-w-[1120px] px-6 pb-28 pt-8 md:px-10 md:pb-16">
      {/* top: photos + title block */}
      <div className="grid grid-cols-1 gap-10 md:grid-cols-[1fr_380px] lg:gap-12">
        <div className="relative grid aspect-square grid-cols-2 grid-rows-2 gap-1.5 overflow-hidden rounded-3xl">
          {[0, 1, 2, 3].map((i) => (
            <button key={i} onClick={() => setShowPhotos(true)} className="group relative overflow-hidden bg-soft">
              <SafeImage
                src={photos[i % photos.length] ?? ""}
                seed={`exp-${exp.id}-${i}`}
                alt={`${exp.title} photo ${i + 1}`}
                className="h-full w-full object-cover transition group-hover:brightness-90"
              />
            </button>
          ))}
          <button
            onClick={() => setShowPhotos(true)}
            aria-label="Show all photos"
            className="absolute bottom-4 right-4 rounded-full bg-white/90 p-2 shadow hover:bg-white"
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col">
          <div className="text-center">
            <h1 className="text-[28px] font-semibold leading-8 md:text-[32px] md:leading-9">{exp.title}</h1>
            <p className="mt-3 text-muted">{exp.tagline}</p>
            <p className="mt-4 flex items-center justify-center gap-1 text-sm">
              {ratingLabel ? (
                <>
                  <RatingStar className="h-3 w-3" /> <span className="font-semibold">{ratingLabel}</span> ·
                  <button onClick={() => setShowReviews(true)} className="underline">
                    {plural(exp.review_count, "rating")}
                  </button>
                </>
              ) : (
                <span className="font-semibold">New</span>
              )}
            </p>
            <p className="text-sm text-muted">
              {exp.city} · {exp.category}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button onClick={share} aria-label="Share" className="rounded-full p-2 hover:bg-soft">
                <Share className="h-4 w-4" />
              </button>
              <button onClick={() => toggleSavedExperience(exp.id, { image: photos[0] })} aria-label="Save" className="rounded-full p-2 hover:bg-soft">
                <Heart className={`h-4 w-4 ${saved ? "fill-brand stroke-brand" : ""}`} />
              </button>
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-2 text-xs">
              {exp.private_groups && <span className="rounded-md bg-soft px-2 py-1">Private groups welcome</span>}
              {exp.free_cancellation && <span className="rounded-md bg-soft px-2 py-1">Free cancellation</span>}
            </div>
          </div>

          <div className="mt-8 space-y-6 border-t border-line pt-8">
            <Info icon={<Avatar src={exp.host.avatar_url} name={exp.host.name} size={36} />} title={`Hosted by ${exp.host.name}`} text={exp.host_title} />
            <Info icon={<MapPin className="h-6 w-6" />} title={exp.meeting_point} text={[exp.city, exp.state].filter(Boolean).join(", ")} />
            <Info
              icon={<Clock className="h-6 w-6" />}
              title={`Around ${formatDuration(exp.duration_minutes).replace("hour", "hr")} ${copy.noun}`}
              text={`Hosted in ${exp.language}`}
            />
            <Info icon={<ClipboardList className="h-6 w-6" />} title="What's included" text={exp.included} />
          </div>
        </div>
      </div>

      {/* body + sticky dates card */}
      <div className="mt-12 grid grid-cols-1 gap-10 md:grid-cols-[1fr_380px] lg:gap-12">
        <div className="min-w-0">
          <section className="border-b border-line pb-10">
            <h2 className="text-[22px] font-semibold">{copy.activities}</h2>
            <ol className="relative mt-6 space-y-6">
              {exp.activities.map((a, i) => (
                <li key={a.id} className="relative flex gap-6">
                  {i < exp.activities.length - 1 && <span className="absolute left-[42px] top-[84px] h-[calc(100%-60px)] w-px bg-line" />}
                  <SafeImage src={a.photo_url ?? photos[0] ?? ""} seed={`act-${a.id}`} alt="" className="h-[84px] w-[84px] shrink-0 rounded-xl object-cover" />
                  <div className="pt-4">
                    <p className="font-semibold">{a.title}</p>
                    <p className="text-sm text-muted">{a.description}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-8 whitespace-pre-line leading-6">{exp.description}</p>
          </section>

          {/* reviews */}
          <section className="border-b border-line py-10">
            {reviews.length === 0 ? (
              <h2 className="text-[22px] font-semibold">No ratings (yet)</h2>
            ) : (
              <>
                <h2 className="flex items-center gap-2 text-[22px] font-semibold">
                  <Star className="h-5 w-5 fill-current" /> {ratingLabel} · {plural(exp.review_count, "rating")}
                </h2>
                <div className="mt-8 grid grid-cols-1 gap-x-12 gap-y-10 sm:grid-cols-2">
                  {reviews.slice(0, 6).map((r) => (
                    <ReviewItem key={r.id} review={r} />
                  ))}
                </div>
                <button onClick={() => setShowReviews(true)} className="mt-10 w-full rounded-lg bg-soft py-3 text-sm font-semibold hover:bg-line">
                  Show all ratings
                </button>
              </>
            )}
          </section>

          {/* map */}
          <section className="border-b border-line py-10">
            <h2 className="text-[22px] font-semibold">{copy.where}</h2>
            <p className="mt-4">{exp.meeting_point}</p>
            <p className="text-muted">{exp.address}</p>
            <div className="mt-6 h-[320px] overflow-hidden rounded-2xl bg-soft">
              <iframe
                title="Map"
                className="h-full w-full"
                loading="lazy"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${exp.longitude - 0.02}%2C${exp.latitude - 0.012}%2C${exp.longitude + 0.02}%2C${exp.latitude + 0.012}&layer=mapnik&marker=${exp.latitude}%2C${exp.longitude}`}
              />
            </div>
          </section>

          {/* host */}
          <section className="py-10">
            <h2 className="text-[22px] font-semibold">Meet your host</h2>
            <div className="mt-6 flex items-center gap-5">
              <div className="relative">
                <Avatar src={exp.host.avatar_url} name={exp.host.name} size={72} />
                {exp.host.is_superhost && <Medal className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-brand stroke-white p-1" />}
              </div>
              <div>
                <p className="text-lg font-semibold">{exp.host.name}</p>
                <p className="text-sm text-muted">
                  {exp.host_title} · {plural(yearsSince(exp.host.created_at), "year")} hosting
                  {exp.host.rating ? ` · ${exp.host.rating.toFixed(2)}★ across ${plural(exp.host.review_count, "rating")}` : ""}
                </p>
              </div>
            </div>
            {exp.host.bio && <p className="mt-5 leading-6">{exp.host.bio}</p>}
            {isOwn ? (
              <p className="mt-6 text-sm font-semibold text-muted">You host this {copy.noun}</p>
            ) : (
              <MessageButton listingType={exp.kind} listingId={exp.id} label={`Message ${exp.host.name.split(" ")[0]}`} className="mt-6" />
            )}
          </section>
        </div>

        {/* sticky dates card (desktop) */}
        <div className="hidden md:block">
          <div className="sticky top-28 overflow-hidden rounded-3xl border border-line shadow-card">
            <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-5">
              <div>
                <p>
                  From <span className="font-semibold underline">{formatPrice(exp.price_per_guest)}</span>{" "}
                  <span className="text-xs text-muted">/ guest</span>
                </p>
                {exp.free_cancellation && <p className="text-xs text-brand">Free cancellation</p>}
              </div>
              <BrandButton onClick={() => setShowDates(true)} className="rounded-full !px-5 !py-3">
                Show dates
              </BrandButton>
            </div>
            <div className="space-y-2 p-4">
              <div className="flex items-center justify-between px-1 pb-1 text-sm">
                <span className="text-muted">Guests</span>
                <Counter value={guests} onChange={setGuests} min={1} max={exp.max_guests} />
              </div>
              {slots === null ? (
                <Spinner />
              ) : slots.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted">No open dates for {plural(guests, "guest")}.</p>
              ) : (
                slots.slice(0, 5).map((s) => <SlotButton key={s.id} slot={s} onClick={() => pick(s)} />)
              )}
              {slots && slots.length > 5 && (
                <button onClick={() => setShowDates(true)} className="w-full py-3 text-sm text-muted hover:text-ink hover:underline">
                  Show all dates
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {more.length > 0 && (
        <div className="border-t border-line pt-6">
          <ExperienceRow
            title={`More ${copy.plural} in ${exp.city}`}
            href={`${copy.base}?location=${encodeURIComponent(exp.city)}`}
            items={more}
            badge="none"
            showMeta
          />
        </div>
      )}

      {/* mobile bottom bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between border-t border-line bg-white px-6 py-4 md:hidden">
        <div>
          <p>
            From <span className="font-semibold">{formatPrice(exp.price_per_guest)}</span> <span className="text-sm">/ guest</span>
          </p>
          {exp.free_cancellation && <p className="text-xs text-brand">Free cancellation</p>}
        </div>
        <BrandButton onClick={() => setShowDates(true)} className="rounded-full">Show dates</BrandButton>
      </div>

      {/* all dates */}
      <Modal open={showDates} onClose={() => setShowDates(false)} title="Choose a date">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="font-semibold">Guests</p>
            <p className="text-sm text-muted">Up to {exp.max_guests}</p>
          </div>
          <Counter value={guests} onChange={setGuests} min={1} max={exp.max_guests} />
        </div>
        {slotsByDay.length === 0 ? (
          <p className="py-10 text-center text-muted">No open dates for {plural(guests, "guest")} in the next 60 days.</p>
        ) : (
          <div className="space-y-6">
            {slotsByDay.map(([day, list]) => (
              <div key={day}>
                <p className="mb-2 font-semibold">{formatSlotDay(list[0].starts_at)}</p>
                <div className="space-y-2">
                  {list.map((s) => (
                    <SlotButton key={s.id} slot={s} onClick={() => pick(s)} compact />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <BookingModal
        experience={exp}
        slot={selected}
        guests={guests}
        onGuests={setGuests}
        onClose={() => setSelected(null)}
        onBooked={() => {
          setSelected(null);
          setReloadSlots((n) => n + 1);
          router.push("/trips");
        }}
        onConflict={() => {
          // the slot's spots changed under us: close and show the refreshed times
          setSelected(null);
          setReloadSlots((n) => n + 1);
        }}
      />

      <Modal open={showPhotos} onClose={() => setShowPhotos(false)} title="Photos" wide>
        <div className="grid grid-cols-2 gap-2">
          {photos.map((src, i) => (
            <SafeImage key={i} src={src} seed={`exp-${exp.id}-${i}`} alt="" className={`w-full object-cover ${i % 3 === 0 ? "col-span-2 h-96" : "h-60"}`} />
          ))}
        </div>
      </Modal>
      <Modal open={showReviews} onClose={() => setShowReviews(false)} title={plural(reviews.length, "rating")} wide>
        <div className="space-y-8">
          {reviews.map((r) => (
            <ReviewItem key={r.id} review={r} full />
          ))}
        </div>
      </Modal>
    </div>
  );
}

function Info({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex items-center gap-4">
      <span className="flex w-9 shrink-0 justify-center">{icon}</span>
      <div className="text-sm">
        <p className="font-medium">{title}</p>
        <p className="text-muted">{text}</p>
      </div>
    </div>
  );
}

function SlotButton({ slot, onClick, compact }: { slot: Slot; onClick: () => void; compact?: boolean }) {
  const low = slot.spots_left <= 3;
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between rounded-xl border border-line px-5 py-4 text-left transition hover:border-ink">
      <span>
        {!compact && <span className="block font-medium">{formatSlotDay(slot.starts_at)}</span>}
        <span className={compact ? "font-medium" : "text-xs text-muted"}>{formatTimeRange(slot.starts_at, slot.ends_at)}</span>
      </span>
      {low && <span className="text-xs font-semibold text-brand">{plural(slot.spots_left, "spot")} left</span>}
    </button>
  );
}

function ReviewItem({ review, full }: { review: Review; full?: boolean }) {
  const [open, setOpen] = useState(false);
  const when = new Date(review.created_at);
  const days = (Date.now() - when.getTime()) / 86_400_000;
  const label =
    days < 7 ? "This week" : days < 30 ? plural(Math.floor(days / 7), "week") + " ago" : when.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const long = review.comment.length > 180;
  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar src={review.author.avatar_url} name={review.author.name} size={40} />
        <p className="text-sm font-semibold">{review.author.name.split(" ")[0]}</p>
      </div>
      <p className="mt-3 flex items-center gap-1 text-xs text-muted">
        <span className="flex">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} className={`h-2.5 w-2.5 ${i < review.rating ? "fill-ink stroke-ink" : "stroke-gray-300"}`} />
          ))}
        </span>
        · {label}
      </p>
      <p className={`mt-1 text-sm leading-6 ${full || open ? "" : "line-clamp-4"}`}>{review.comment}</p>
      {!full && long && !open && (
        <button onClick={() => setOpen(true)} className="mt-1 text-sm font-semibold underline">
          Show more
        </button>
      )}
    </div>
  );
}

function BookingModal({
  experience,
  slot,
  guests,
  onGuests,
  onClose,
  onBooked,
  onConflict,
}: {
  experience: ExperienceDetail;
  slot: Slot | null;
  guests: number;
  onGuests: (n: number) => void;
  onClose: () => void;
  onBooked: () => void;
  onConflict: () => void;
}) {
  const { user, toast } = useApp();
  const [quote, setQuote] = useState<ExperienceQuote | null>(null);
  const [saving, setSaving] = useState(false);
  const max = slot ? Math.min(experience.max_guests, slot.spots_left) : experience.max_guests;

  useEffect(() => {
    if (!slot) return;
    if (guests > max) onGuests(max);
  }, [slot, guests, max, onGuests]);

  useEffect(() => {
    setQuote(null);
    if (!slot) return;
    let stale = false;
    api
      .experienceQuote(experience.id, Math.min(guests, max))
      .then((q) => !stale && setQuote(q))
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [experience.id, slot, guests, max]);

  const confirm = async () => {
    if (!slot || saving) return;
    setSaving(true);
    try {
      await api.bookExperience({ slot_id: slot.id, guests });
      toast(`Booked! ${formatSlotDay(slot.starts_at)}, ${formatTimeRange(slot.starts_at, slot.ends_at)}`, "success", experience.photos[0]);
      onBooked();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't book that time", "error");
      onConflict();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={Boolean(slot)}
      onClose={onClose}
      title="Confirm and pay"
      footer={
        <BrandButton onClick={confirm} disabled={saving || !quote || !user} className="w-full">
          {saving ? "Booking…" : quote ? `Confirm and pay ${formatPrice(quote.total)}` : "Confirm and pay"}
        </BrandButton>
      }
    >
      {slot && (
        <>
          <div className="flex gap-4">
            <SafeImage src={experience.photos[0] ?? ""} seed={`exp-${experience.id}-0`} alt="" className="h-24 w-24 shrink-0 rounded-xl object-cover" />
            <div>
              <p className="font-semibold leading-5">{experience.title}</p>
              <p className="mt-1 text-sm text-muted">Hosted by {experience.host.name}</p>
              {experience.rating !== null && (
                <p className="mt-1 flex items-center gap-1 text-sm">
                  <RatingStar className="h-3 w-3" /> {experience.rating.toFixed(2)} ({experience.review_count})
                </p>
              )}
            </div>
          </div>

          <div className="mt-6 space-y-4 border-t border-line pt-6">
            <div>
              <p className="font-semibold">Date & time</p>
              <p className="text-muted">
                {formatSlotDay(slot.starts_at)} · {formatTimeRange(slot.starts_at, slot.ends_at)}
              </p>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">Guests</p>
                <p className="text-sm text-muted">{plural(slot.spots_left, "spot")} left at this time</p>
              </div>
              <Counter value={guests} onChange={onGuests} min={1} max={max} />
            </div>
          </div>

          {quote && (
            <div className="mt-6 space-y-3 border-t border-line pt-6">
              <p className="text-lg font-semibold">Price details</p>
              <Row label={`${formatPrice(quote.price_per_guest)} x ${plural(quote.guests, "guest")}`} value={formatPrice(quote.subtotal)} />
              <Row label="Airbnb service fee" value={formatPrice(quote.service_fee)} />
              <Row label="Taxes" value={formatPrice(quote.taxes)} />
              <div className="flex justify-between border-t border-line pt-3 font-semibold">
                <span>Total (INR)</span>
                <span>{formatPrice(quote.total)}</span>
              </div>
            </div>
          )}
          {experience.free_cancellation && (
            <p className="mt-6 text-sm text-muted">
              <span className="font-semibold text-ink">Free cancellation</span> any time before it starts. Payment is mocked.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="underline">{label}</span>
      <span>{value}</span>
    </div>
  );
}
