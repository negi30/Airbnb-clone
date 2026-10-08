"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Compass, Home, MessageSquare, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { Avatar, Modal, RatingStar, SafeImage, Spinner } from "@/components/ui";
import { experienceHref } from "@/components/ExperienceCard";
import MessageButton from "@/components/MessageButton";
import { useApp } from "@/context/AppProvider";
import { api } from "@/lib/api";
import { formatDuration, formatPrice, formatRange, formatSlotDay, formatTimeRange, plural, todayISO } from "@/lib/format";
import type { Booking, ExperienceBooking, ExperienceKind, HostExperience, HostListing } from "@/lib/types";

type Tab = "listings" | "experiences" | "services" | "reservations";
type ReservationType = "home" | ExperienceKind;
const TABS: Tab[] = ["listings", "experiences", "services", "reservations"];
const TYPE_LABEL: Record<ReservationType, string> = { home: "Home", experience: "Experience", service: "Service" };

/** Homes, experiences and services bookings flattened into one row shape for the Reservations tab. */
interface ReservationRow {
  key: string;
  id: number;
  type: ReservationType;
  guest: Booking["guest"];
  title: string;
  href: string;
  when: string;
  detail: string;
  total: number;
  status: "Upcoming" | "In progress" | "Completed" | "Cancelled by you" | "Cancelled by guest";
  sortKey: string;
}

function stayRow(b: Booking, today: string): ReservationRow {
  return {
    key: `home-${b.id}`,
    id: b.id,
    type: "home",
    guest: b.guest,
    title: b.listing.title,
    href: `/listings/${b.listing.id}`,
    when: formatRange(b.check_in, b.check_out),
    detail: `${plural(b.nights, "night")} · ${plural(b.guests, "guest")}`,
    total: b.total_price,
    status:
      b.status === "cancelled"
        ? b.cancelled_by === "host" ? "Cancelled by you" : "Cancelled by guest"
        : b.check_out <= today ? "Completed" : b.check_in <= today ? "In progress" : "Upcoming",
    sortKey: b.check_in,
  };
}

function slotRow(b: ExperienceBooking, now: Date): ReservationRow {
  const starts = new Date(b.slot.starts_at);
  const ends = new Date(b.slot.ends_at);
  return {
    key: `exp-${b.id}`,
    id: b.id,
    type: b.experience.kind,
    guest: b.guest,
    title: b.experience.title,
    href: experienceHref(b.experience),
    when: formatSlotDay(b.slot.starts_at),
    detail: `${formatTimeRange(b.slot.starts_at, b.slot.ends_at)} · ${plural(b.guests, "guest")}`,
    total: b.total_price,
    status:
      b.status === "cancelled"
        ? b.cancelled_by === "host" ? "Cancelled by you" : "Cancelled by guest"
        : ends <= now ? "Completed" : starts <= now ? "In progress" : "Upcoming",
    sortKey: b.slot.starts_at, // full timestamp so same-day slots stay in time order
  };
}

export default function HostPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <HostDashboard />
    </Suspense>
  );
}

function HostDashboard() {
  const { user, users, switchUser, toast } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: Tab = TABS.includes(params.get("tab") as Tab) ? (params.get("tab") as Tab) : "listings";
  const setTab = (t: Tab) => router.replace(t === "listings" ? pathname : `${pathname}?tab=${t}`, { scroll: false });

  const [listings, setListings] = useState<HostListing[] | null>(null);
  const [experiences, setExperiences] = useState<HostExperience[] | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [expBookings, setExpBookings] = useState<ExperienceBooking[]>([]);
  const [typeFilter, setTypeFilter] = useState<ReservationType | "all">("all");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<{ type: ReservationType; id: number; title: string; photo?: string } | null>(null);
  const [cancelling, setCancelling] = useState<ReservationRow | null>(null);
  const [busy, setBusy] = useState(false);

  // answers from a previous load (e.g. the host before an account switch) are ignored
  const loadId = useRef(0);
  const load = useCallback(() => {
    const id = ++loadId.current;
    const latest = () => id === loadId.current;
    api.hostListings().then((v) => latest() && setListings(v)).catch(() => latest() && setListings([]));
    api.hostExperiences().then((v) => latest() && setExperiences(v)).catch(() => latest() && setExperiences([]));
    api.hostBookings().then((v) => latest() && setBookings(v)).catch(() => latest() && setBookings([]));
    api.hostExperienceBookings().then((v) => latest() && setExpBookings(v)).catch(() => latest() && setExpBookings([]));
  }, []);

  useEffect(() => {
    if (!user?.is_host) return;
    // clear the previous host's data so it never shows under the new account
    setListings(null);
    setExperiences(null);
    setBookings([]);
    setExpBookings([]);
    load();
  }, [user, load]);

  const rows = useMemo(() => {
    const today = todayISO();
    const now = new Date();
    // what needs attention first: in progress / upcoming soonest-first, then history newest-first
    const active = (r: ReservationRow) => r.status === "Upcoming" || r.status === "In progress";
    return [...bookings.map((b) => stayRow(b, today)), ...expBookings.map((b) => slotRow(b, now))].sort((a, b) =>
      active(a) !== active(b) ? (active(a) ? -1 : 1) : active(a) ? a.sortKey.localeCompare(b.sortKey) : b.sortKey.localeCompare(a.sortKey),
    );
  }, [bookings, expBookings]);

  if (!user) return <Spinner />;

  if (!user.is_host) {
    const hosts = users.filter((u) => u.is_host);
    return (
      <div className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="text-[32px] font-semibold">Airbnb it. Earn as a host.</h1>
        <p className="mt-3 text-muted">
          You&apos;re signed in as a guest. Authentication is mocked in this demo, so switch to a host account to manage listings.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {hosts.map((h) => (
            <button key={h.id} onClick={() => switchUser(h.id)} className="flex items-center gap-2 rounded-full border border-line py-1.5 pl-1.5 pr-4 hover:border-ink">
              <Avatar src={h.avatar_url} name={h.name} size={32} /> {h.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!listings || !experiences) return <Spinner />;

  const exps = experiences.filter((e) => e.kind === "experience");
  const services = experiences.filter((e) => e.kind === "service");
  const confirmedStays = bookings.filter((b) => b.status === "confirmed");
  const confirmedSlots = expBookings.filter((b) => b.status === "confirmed");
  const upcomingCount = rows.filter((r) => r.status === "Upcoming").length;
  const earnings =
    confirmedStays.reduce((s, b) => s + b.total_price - b.service_fee - b.taxes, 0) +
    confirmedSlots.reduce((s, b) => s + b.subtotal, 0);
  const offerings = [
    listings.length && plural(listings.length, "home"),
    exps.length && plural(exps.length, "experience"),
    services.length && plural(services.length, "service"),
  ].filter(Boolean) as string[];
  const shownRows = typeFilter === "all" ? rows : rows.filter((r) => r.type === typeFilter);

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      if (deleting.type === "home") await api.deleteListing(deleting.id);
      else await api.deleteExperience(deleting.id);
      toast(`${TYPE_LABEL[deleting.type]} deleted`, "success", deleting.photo);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't delete", "error");
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  };

  const cancel = async () => {
    if (!cancelling) return;
    setBusy(true);
    try {
      await api.hostCancelReservation(cancelling.type, cancelling.id);
      toast(`Reservation cancelled — ${cancelling.guest.name.split(" ")[0]} gets a full refund`, "success");
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't cancel", "error");
    } finally {
      setBusy(false);
      setCancelling(null);
    }
  };

  const tabLabel: Record<Tab, string> = {
    listings: `Your Listings (${listings.length})`,
    experiences: `Your Experiences (${exps.length})`,
    services: `Your Services (${services.length})`,
    reservations: `Reservations (${rows.length})`,
  };

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-10 md:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[32px] font-semibold">Welcome back, {user.name.split(" ")[0]}</h1>
          <p className="text-muted">
            {user.is_superhost ? "Superhost · " : ""}Here&apos;s what&apos;s happening with your {joinWords(
              [listings.length && "homes", exps.length && "experiences", services.length && "services"].filter(Boolean) as string[],
            ) || "listings"}
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/host/messages" className="flex items-center gap-2 rounded-lg border border-ink px-5 py-3 font-semibold hover:bg-soft">
            <MessageSquare className="h-4 w-4" /> Messages
          </Link>
          <button onClick={() => setCreating(true)} className="flex items-center gap-2 rounded-lg bg-ink px-5 py-3 font-semibold text-white hover:bg-black">
            <Plus className="h-4 w-4" /> Create listing
          </button>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Listings" value={listings.length + experiences.length} hint={offerings.join(" · ") || undefined} />
        <StatCard label="Upcoming reservations" value={upcomingCount} />
        <StatCard
          label="Total reservations"
          value={confirmedStays.length + confirmedSlots.length}
          hint={rows.length > confirmedStays.length + confirmedSlots.length ? `excludes ${rows.length - confirmedStays.length - confirmedSlots.length} cancelled` : undefined}
        />
        <StatCard label="Host earnings" value={formatPrice(earnings)} />
      </div>

      <div className="no-scrollbar mt-10 flex gap-6 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px shrink-0 border-b-2 pb-3 font-semibold ${tab === t ? "border-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {tabLabel[t]}
          </button>
        ))}
      </div>

      {tab === "listings" && (
        <div className="mt-6">
          {listings.length === 0 ? (
            <EmptyState text="You don't have any homes listed yet." href="/host/listings/new" cta="List your home" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-muted">
                  <tr className="border-b border-line">
                    <th className="py-3 font-semibold">Listing</th>
                    <th className="py-3 font-semibold">Location</th>
                    <th className="py-3 font-semibold">Price</th>
                    <th className="py-3 font-semibold">Rating</th>
                    <th className="py-3 font-semibold">Upcoming</th>
                    <th className="py-3 font-semibold">Earned</th>
                    <th className="py-3" />
                  </tr>
                </thead>
                <tbody>
                  {listings.map((l) => (
                    <tr key={l.id} className="border-b border-line hover:bg-soft/60">
                      <td className="py-3">
                        <Link href={`/listings/${l.id}`} className="flex items-center gap-4">
                          <SafeImage src={l.photos[0] ?? ""} seed={`${l.id}-0`} alt="" className="h-14 w-20 rounded-lg object-cover" />
                          <span className="max-w-[260px] font-semibold hover:underline">{l.title}</span>
                        </Link>
                      </td>
                      <td>{l.city}, {l.country}</td>
                      <td>{formatPrice(l.price_per_night)}</td>
                      <td><Rating value={l.rating} count={l.review_count} /></td>
                      <td>{l.upcoming_bookings}</td>
                      <td>{formatPrice(l.total_earnings)}</td>
                      <td>
                        <RowActions
                          editHref={`/host/listings/${l.id}/edit`}
                          onDelete={() => setDeleting({ type: "home", id: l.id, title: l.title, photo: l.photos[0] })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {(tab === "experiences" || tab === "services") && (
        <ExperienceTable
          kind={tab === "experiences" ? "experience" : "service"}
          items={tab === "experiences" ? exps : services}
          onDelete={(e) => setDeleting({ type: e.kind, id: e.id, title: e.title, photo: e.photos[0] })}
        />
      )}

      {tab === "reservations" && (
        <div className="mt-6">
          <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto">
            {(["all", "home", "experience", "service"] as const).map((t) => {
              const count = t === "all" ? rows.length : rows.filter((r) => r.type === t).length;
              return (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition ${
                    typeFilter === t ? "border-ink bg-ink text-white" : "border-line hover:border-ink"
                  }`}
                >
                  {t === "all" ? "All" : `${TYPE_LABEL[t]}s`} ({count})
                </button>
              );
            })}
          </div>
          <div className="space-y-3">
            {shownRows.length === 0 && <p className="py-16 text-center text-muted">No reservations yet.</p>}
            {shownRows.map((r) => (
              <div key={r.key} className="flex flex-wrap items-center gap-4 rounded-xl border border-line p-4">
                <Avatar src={r.guest.avatar_url} name={r.guest.name} size={44} />
                <div className="min-w-[180px] flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {r.guest.name}
                    <TypeBadge type={r.type} />
                  </p>
                  <Link href={r.href} className="text-sm text-muted hover:underline">{r.title}</Link>
                </div>
                <div className="text-sm">
                  <p className="font-semibold">{r.when}</p>
                  <p className="text-muted">{r.detail}</p>
                </div>
                <p className="w-28 text-sm font-semibold">{formatPrice(r.total)}</p>
                <StatusBadge status={r.status} />
                <MessageButton variant="icon" listingType={r.type} reservationId={r.id} label={`Message ${r.guest.name.split(" ")[0]}`} />
                {r.status === "Upcoming" ? (
                  <button onClick={() => setCancelling(r)} className="w-14 text-sm font-semibold underline">Cancel</button>
                ) : (
                  <span className="w-14" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="What would you like to host?">
        <div className="space-y-3">
          {[
            { href: "/host/listings/new", icon: Home, title: "Home", text: "A place guests stay overnight: a room, flat, villa or cabin." },
            { href: "/host/experiences/new?kind=experience", icon: Compass, title: "Experience", text: "A tour, class or activity you lead, booked by time slot." },
            { href: "/host/experiences/new?kind=service", icon: Sparkles, title: "Service", text: "Photography, a private chef, massage and more, at the guest's stay." },
          ].map(({ href, icon: Icon, title, text }) => (
            <Link key={title} href={href} onClick={() => setCreating(false)} className="flex items-center gap-4 rounded-xl border border-line p-5 transition hover:border-ink hover:bg-soft">
              <Icon className="h-8 w-8 shrink-0" strokeWidth={1.5} />
              <span>
                <span className="block font-semibold">{title}</span>
                <span className="text-sm text-muted">{text}</span>
              </span>
            </Link>
          ))}
        </div>
      </Modal>

      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting ? TYPE_LABEL[deleting.type].toLowerCase() : "listing"}?`}
        footer={
          <div className="flex justify-end gap-3">
            <button onClick={() => setDeleting(null)} className="px-5 py-3 font-semibold underline">Keep</button>
            <button disabled={busy} onClick={remove} className="rounded-lg bg-brand px-6 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Deleting…" : "Delete"}</button>
          </div>
        }
      >
        <p>
          <b>{deleting?.title}</b> will be permanently removed with its photos and reviews. Anything with upcoming
          reservations can&apos;t be deleted until those are cancelled.
        </p>
      </Modal>
      <Modal
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        title="Cancel this reservation?"
        footer={
          <div className="flex justify-end gap-3">
            <button onClick={() => setCancelling(null)} className="px-5 py-3 font-semibold underline">Back</button>
            <button disabled={busy} onClick={cancel} className="rounded-lg bg-ink px-6 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Cancelling…" : "Cancel reservation"}</button>
          </div>
        }
      >
        {cancelling && (
          <p>
            {cancelling.guest.name}&apos;s {TYPE_LABEL[cancelling.type].toLowerCase()} booking (<b>{cancelling.title}</b>, {cancelling.when}) will be
            cancelled. They&apos;ll see that you cancelled it on their Trips page and get a full refund of {formatPrice(cancelling.total)}.
          </p>
        )}
      </Modal>
    </div>
  );
}

function ExperienceTable({ kind, items, onDelete }: { kind: ExperienceKind; items: HostExperience[]; onDelete: (e: HostExperience) => void }) {
  const noun = kind === "experience" ? "experience" : "service";
  if (items.length === 0)
    return (
      <div className="mt-6">
        <EmptyState text={`You don't host any ${noun}s yet.`} href={`/host/experiences/new?kind=${kind}`} cta={`Create ${noun === "experience" ? "an" : "a"} ${noun}`} />
      </div>
    );
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="text-muted">
          <tr className="border-b border-line">
            <th className="py-3 font-semibold">{kind === "experience" ? "Experience" : "Service"}</th>
            <th className="py-3 font-semibold">Category</th>
            <th className="py-3 font-semibold">Location</th>
            <th className="py-3 font-semibold">Price</th>
            <th className="py-3 font-semibold">Rating</th>
            <th className="py-3 font-semibold">Upcoming</th>
            <th className="py-3 font-semibold">Earned</th>
            <th className="py-3" />
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id} className="border-b border-line hover:bg-soft/60">
              <td className="py-3">
                <Link href={experienceHref(e)} className="flex items-center gap-4">
                  <SafeImage src={e.photos[0] ?? ""} seed={`exp-${e.id}`} alt="" className="h-14 w-20 rounded-lg object-cover" />
                  <span className="max-w-[240px] font-semibold hover:underline">{e.title}</span>
                </Link>
              </td>
              <td>
                {e.category}
                <span className="block text-muted">{formatDuration(e.duration_minutes)}</span>
              </td>
              <td>{e.city}, {e.country}</td>
              <td>
                {formatPrice(e.price_per_guest)}
                <span className="block text-muted">/ guest</span>
              </td>
              <td><Rating value={e.rating} count={e.review_count} /></td>
              <td>
                {plural(e.upcoming_bookings, "booking")}
                <span className="block text-muted">{plural(e.upcoming_slots, "open slot")}</span>
              </td>
              <td>{formatPrice(e.total_earnings)}</td>
              <td>
                <RowActions editHref={`/host/experiences/${e.id}/edit`} onDelete={() => onDelete(e)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowActions({ editHref, onDelete }: { editHref: string; onDelete: () => void }) {
  return (
    <div className="flex justify-end gap-1">
      <Link href={editHref} aria-label="Edit" className="rounded-full p-2 hover:bg-gray-200">
        <Pencil className="h-4 w-4" />
      </Link>
      <button aria-label="Delete" onClick={onDelete} className="rounded-full p-2 hover:bg-gray-200">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

function Rating({ value, count }: { value: number | null; count: number }) {
  return value ? (
    <span className="flex items-center gap-1"><RatingStar /> {value.toFixed(2)} ({count})</span>
  ) : (
    <>New</>
  );
}

function TypeBadge({ type }: { type: ReservationType }) {
  const style = { home: "bg-sky-50 text-sky-700", experience: "bg-amber-50 text-amber-700", service: "bg-violet-50 text-violet-700" }[type];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style}`}>{TYPE_LABEL[type]}</span>;
}

function StatusBadge({ status }: { status: ReservationRow["status"] }) {
  const style =
    status === "Upcoming"
      ? "bg-emerald-50 text-emerald-700"
      : status.startsWith("Cancelled")
        ? "bg-red-50 text-red-600"
        : status === "In progress"
          ? "bg-amber-50 text-amber-700"
          : "bg-soft text-muted";
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${style}`}>{status}</span>;
}

function EmptyState({ text, href, cta }: { text: string; href: string; cta: string }) {
  return (
    <div className="py-16 text-center">
      <p className="text-muted">{text}</p>
      <Link href={href} className="mt-4 inline-block rounded-lg border border-ink px-5 py-2.5 font-semibold hover:bg-soft">{cta}</Link>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-line p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

const joinWords = (words: string[]) =>
  words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
