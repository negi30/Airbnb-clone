"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Info, MessageSquare, Search, SendHorizontal, ShieldAlert, ShieldCheck } from "lucide-react";
import { Avatar, Modal, SafeImage, Spinner } from "./ui";
import { experienceHref } from "./ExperienceCard";
import { useApp } from "@/context/AppProvider";
import { api, ApiError, MESSAGES_READ_EVENT } from "@/lib/api";
import { formatPrice, formatRange, formatSlotDay, formatTimeRange, plural } from "@/lib/format";
import { checkMessage, MAX_MESSAGE_LENGTH, PLACEHOLDER, SAFETY_WARNING } from "@/lib/moderation";
import type { ConversationDetail, ConversationListing, ConversationSummary, Message, ThreadStatus } from "@/lib/types";

type Filter = "all" | "unread" | "home" | "experience" | "service";
const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["unread", "Unread"],
  ["home", "Homes"],
  ["experience", "Experiences"],
  ["service", "Services"],
];

const STATUS: Record<ThreadStatus, { label: string; style: string }> = {
  inquiry: { label: "Inquiry", style: "bg-soft text-muted" },
  upcoming: { label: "Upcoming", style: "bg-emerald-50 text-emerald-700" },
  in_progress: { label: "In progress", style: "bg-amber-50 text-amber-700" },
  completed: { label: "Completed", style: "bg-soft text-muted" },
  cancelled_by_host: { label: "Cancelled by Host", style: "bg-rose-600 text-white" },
  cancelled_by_guest: { label: "Cancelled by Guest", style: "bg-red-50 text-red-600" },
};
const TYPE_LABEL = { home: "Home", experience: "Experience", service: "Service" } as const;

export const listingHref = (l: Pick<ConversationListing, "type" | "id">) =>
  l.type === "home" ? `/listings/${l.id}` : experienceHref({ id: l.id, kind: l.type });

const POLL_THREAD_MS = 8000;
const POLL_LIST_MS = 20000;

/** Runs `fn` every `ms` while the tab is visible. */
function usePoll(fn: () => void, ms: number, enabled = true) {
  const saved = useRef(fn);
  useEffect(() => {
    saved.current = fn;
  }, [fn]);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => document.visibilityState === "visible" && saved.current(), ms);
    return () => window.clearInterval(id);
  }, [ms, enabled]);
}

function listTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (now.getTime() - d.getTime() < 6 * 86400000) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

/** Everything a poll can change in an open thread: new messages, read receipts, booking status. */
const threadSig = (c: ConversationDetail) =>
  `${c.status}|${c.unread_count}|${c.messages.map((m) => `${m.id}:${m.read_at ?? ""}`).join(",")}`;

const preview = (m: Message | null, mine: boolean) =>
  !m ? "No messages yet" : `${mine ? "You: " : ""}${m.is_blocked ? "Message hidden by Airbnb" : m.content.replaceAll(PLACEHOLDER, "[hidden]")}`;

export default function Inbox({ scope }: { scope: "all" | "host" }) {
  const { user } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const activeId = Number(params.get("c")) || null;

  const [list, setList] = useState<ConversationSummary[] | null>(null);
  const [active, setActive] = useState<ConversationDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const activeRef = useRef(activeId);
  useEffect(() => {
    activeRef.current = activeId;
  }, [activeId]);

  const open = (id: number | null) => router.push(id ? `${pathname}?c=${id}` : pathname, { scroll: false });

  const listLoad = useRef(0);
  const loadList = useCallback(() => {
    const id = ++listLoad.current; // a slower, older answer (e.g. the previous account's) is dropped
    api
      .conversations(scope === "host" ? "host" : undefined)
      .then((l) => id === listLoad.current && setList(l))
      .catch(() => id === listLoad.current && setList((l) => l ?? []));
  }, [scope]);

  const markRead = useCallback((c: ConversationDetail) => {
    if (c.unread_count === 0) return;
    api
      .markConversationRead(c.id)
      .then(() => {
        setList((l) => l?.map((x) => (x.id === c.id ? { ...x, unread_count: 0 } : x)) ?? l);
        window.dispatchEvent(new Event(MESSAGES_READ_EVENT));
      })
      .catch(() => undefined);
  }, []);

  const loadActive = useCallback(
    (id: number, quiet = false) => {
      api
        .conversation(id)
        .then((c) => {
          if (c.id !== activeRef.current) return; // the user has opened another thread meanwhile
          setMissing(false);
          setActive((prev) => (quiet && prev?.id === c.id && threadSig(prev) === threadSig(c) ? prev : c));
          // keep the list row in step with what the open thread shows
          setList((l) =>
            l?.map((x) => (x.id === c.id ? { ...x, last_message: c.last_message, updated_at: c.updated_at, status: c.status } : x)) ?? l,
          );
          markRead(c);
        })
        .catch(() => {
          if (!quiet && id === activeRef.current) {
            setActive(null);
            setMissing(true);
          }
        });
    },
    [markRead],
  );

  useEffect(() => {
    if (!user) return;
    // a new account never sees the previous one's threads, even for a moment
    setList(null);
    setActive(null);
    setMissing(false);
    loadList();
  }, [user, loadList]);

  useEffect(() => {
    setShowDetails(false);
    if (!user || !activeId) {
      setActive(null);
      setMissing(false);
      return;
    }
    setActive((prev) => (prev?.id === activeId ? prev : null));
    loadActive(activeId);
  }, [user, activeId, loadActive]);

  usePoll(loadList, POLL_LIST_MS, Boolean(user));
  usePoll(() => activeId && loadActive(activeId, true), POLL_THREAD_MS, Boolean(user && activeId));

  // a thread opened from "Message host" has no messages yet, so it isn't in the inbox list
  const threads = useMemo(() => {
    if (!list) return null;
    if (active && !list.some((c) => c.id === active.id)) return [active as ConversationSummary, ...list];
    return list;
  }, [list, active]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (threads ?? []).filter((c) => {
      if (filter === "unread" && c.unread_count === 0) return false;
      if ((filter === "home" || filter === "experience" || filter === "service") && c.listing?.type !== filter) return false;
      if (!q) return true;
      return [c.counterpart.name, c.listing?.title ?? "", c.listing?.city ?? "", c.last_message?.content ?? ""].some((s) =>
        s.toLowerCase().includes(q),
      );
    });
  }, [threads, filter, query]);

  const onSent = (m: Message) => {
    setActive((c) => (c ? { ...c, messages: [...c.messages, m], last_message: m, updated_at: m.created_at } : c));
    setList((l) => {
      if (!l || !active) return l;
      const base = l.find((c) => c.id === active.id) ?? (active as ConversationSummary);
      return [{ ...base, last_message: m, updated_at: m.created_at }, ...l.filter((c) => c.id !== active.id)];
    });
  };

  if (!user || !threads) return <Spinner />;

  const unreadTotal = threads.reduce((n, c) => n + c.unread_count, 0);

  return (
    <div className="mx-auto flex h-[calc(100dvh-81px)] max-w-[1760px] overflow-hidden">
      {/* left: conversation list */}
      <aside className={`${activeId ? "hidden md:flex" : "flex"} w-full flex-col border-r border-line md:w-[340px] md:shrink-0 lg:w-[380px]`}>
        <div className="px-6 pb-3 pt-6">
          <h1 className="text-[28px] font-semibold">{scope === "host" ? "Host messages" : "Messages"}</h1>
          {scope === "host" ? (
            <Link href="/messages" className="text-sm text-muted underline">All messages</Link>
          ) : user.is_host ? (
            <Link href="/host/messages" className="text-sm text-muted underline">Hosting inbox only</Link>
          ) : null}
          <label className="mt-4 flex items-center gap-2 rounded-full border border-line px-4 py-2.5 focus-within:border-ink">
            <Search className="h-4 w-4 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, place or message"
              className="w-full bg-transparent text-sm outline-none"
            />
          </label>
          <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
            {FILTERS.map(([f, label]) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                  filter === f ? "border-ink bg-ink text-white" : "border-line hover:border-ink"
                }`}
              >
                {label}
                {f === "unread" && unreadTotal > 0 ? ` (${unreadTotal})` : ""}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {shown.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <MessageSquare className="mx-auto h-10 w-10 text-muted" strokeWidth={1.5} />
              <p className="mt-3 font-semibold">{threads.length === 0 ? "No messages yet" : "No conversations match"}</p>
              <p className="mt-1 text-sm text-muted">
                {threads.length === 0
                  ? scope === "host"
                    ? "When guests reach out about your listings, their messages appear here."
                    : "Message a host from any home, experience or trip to start a conversation."
                  : "Try a different filter or search."}
              </p>
            </div>
          ) : (
            shown.map((c) => <ThreadRow key={c.id} c={c} me={user.id} selected={c.id === activeId} onOpen={() => open(c.id)} />)
          )}
        </div>
      </aside>

      {/* center: thread */}
      <section className={`${activeId ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
        {!activeId ? (
          <div className="m-auto max-w-sm px-6 text-center">
            <MessageSquare className="mx-auto h-12 w-12 text-muted" strokeWidth={1.25} />
            <p className="mt-4 text-lg font-semibold">Select a conversation</p>
            <p className="mt-1 text-sm text-muted">Your messages with {scope === "host" ? "guests" : "hosts"} appear here.</p>
          </div>
        ) : missing ? (
          <div className="m-auto px-6 text-center">
            <p className="text-lg font-semibold">Conversation not found</p>
            <button onClick={() => open(null)} className="mt-2 text-sm font-semibold underline">Back to inbox</button>
          </div>
        ) : !active ? (
          <Spinner />
        ) : (
          <Thread c={active} me={user.id} onBack={() => open(null)} onDetails={() => setShowDetails(true)} onSent={onSent} />
        )}
      </section>

      {/* right: reservation / listing context */}
      {active && (
        <aside className="hidden w-[340px] shrink-0 overflow-y-auto border-l border-line xl:block">
          <ContextPanel c={active} />
        </aside>
      )}
      <Modal open={showDetails && Boolean(active)} onClose={() => setShowDetails(false)} title="Details">
        {active && <ContextPanel c={active} bare />}
      </Modal>
    </div>
  );
}

function ThreadRow({ c, me, selected, onOpen }: { c: ConversationSummary; me: number; selected: boolean; onOpen: () => void }) {
  const unread = c.unread_count > 0;
  return (
    <button
      onClick={onOpen}
      className={`flex w-full gap-3 px-6 py-4 text-left transition ${selected ? "bg-soft" : "hover:bg-soft/60"}`}
    >
      <div className="relative shrink-0">
        <Avatar src={c.counterpart.avatar_url} name={c.counterpart.name} size={48} />
        {c.listing?.photo && (
          <SafeImage src={c.listing.photo} seed={`thread-${c.id}`} alt="" className="absolute -bottom-1 -right-1 h-6 w-6 rounded-md border-2 border-white object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={`truncate ${unread ? "font-bold" : "font-semibold"}`}>{c.counterpart.name}</p>
          <span className={`shrink-0 text-xs ${unread ? "font-semibold text-ink" : "text-muted"}`}>
            {listTime(c.last_message?.created_at ?? c.updated_at)}
          </span>
        </div>
        <p className={`truncate text-sm ${unread ? "font-semibold text-ink" : "text-muted"}`}>
          {preview(c.last_message, c.last_message?.sender_id === me)}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <p className="min-w-0 truncate text-xs text-muted">
            {c.listing ? `${TYPE_LABEL[c.listing.type]} · ${c.listing.title}` : "Listing removed"}
          </p>
          {unread && (
            <span className="ml-auto shrink-0 rounded-full bg-brand px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">
              {c.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function Thread({
  c,
  me,
  onBack,
  onDetails,
  onSent,
}: {
  c: ConversationDetail;
  me: number;
  onBack: () => void;
  onDetails: () => void;
  onSent: (m: Message) => void;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  const counterpartRole = c.role === "guest" ? "Host" : "Guest";
  const lastMine = [...c.messages].reverse().find((m) => m.sender_id === me);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [c.id, c.messages.length]);

  return (
    <>
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-white px-4 py-3 md:px-6">
        <button onClick={onBack} aria-label="Back to inbox" className="rounded-full p-2 hover:bg-soft md:hidden">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Avatar src={c.counterpart.avatar_url} name={c.counterpart.name} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {c.counterpart.name} <span className="font-normal text-muted">· {counterpartRole}</span>
          </p>
          {c.listing ? (
            <Link href={listingHref(c.listing)} className="block truncate text-sm text-muted underline-offset-2 hover:underline">
              {c.listing.title}
            </Link>
          ) : (
            <p className="text-sm text-muted">This listing is no longer available</p>
          )}
        </div>
        <span className={`hidden shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold sm:inline ${STATUS[c.status].style}`}>
          {STATUS[c.status].label}
        </span>
        <button onClick={onDetails} aria-label="Reservation details" className="rounded-full p-2 hover:bg-soft xl:hidden">
          <Info className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {/* pinned safety notice */}
        <div className="sticky top-0 z-[5] border-b border-line bg-white/95 px-4 py-2.5 backdrop-blur md:px-6">
          <p className="flex items-start gap-2 text-xs leading-5 text-muted">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ink" />
            <span>
              <b className="text-ink">Always communicate through Airbnb</b> · To protect your payment, never transfer money or share phone
              numbers outside of the Airbnb website.
            </span>
          </p>
        </div>

        <div className="space-y-1 px-4 py-6 md:px-6">
          {c.messages.length === 0 && (
            <p className="py-10 text-center text-sm text-muted">
              Say hello to {c.counterpart.name.split(" ")[0]}. Ask about {c.listing ? "the listing, " : ""}timing, or anything else you need.
            </p>
          )}
          {c.messages.map((m, i) => {
            const prev = c.messages[i - 1];
            const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
            return (
              <Fragment key={m.id}>
                {newDay && <p className="py-3 text-center text-xs font-semibold text-muted">{dayLabel(m.created_at)}</p>}
                <Bubble m={m} mine={m.sender_id === me} showRead={m.id === lastMine?.id} />
              </Fragment>
            );
          })}
          <div ref={bottom} />
        </div>
      </div>

      <Composer conversationId={c.id} onSent={onSent} />
    </>
  );
}

/** Message text with every redaction rendered as a visible "hidden" chip. */
function Redacted({ text }: { text: string }) {
  const parts = text.split(PLACEHOLDER);
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {p}
          {i < parts.length - 1 && (
            <span className="mx-0.5 inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[13px] font-semibold not-italic text-amber-900">
              <ShieldAlert className="h-3.5 w-3.5" /> Hidden by Airbnb for safety
            </span>
          )}
        </Fragment>
      ))}
    </>
  );
}

function Bubble({ m, mine, showRead }: { m: Message; mine: boolean; showRead: boolean }) {
  const time = new Date(m.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"} pb-2`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 leading-6 sm:max-w-[70%] ${
          mine ? "rounded-br-md bg-ink text-white" : "rounded-bl-md bg-soft text-ink"
        } ${m.is_blocked ? "italic opacity-90" : ""}`}
      >
        {m.is_blocked ? (
          <span className="flex items-center gap-1.5">
            <ShieldAlert className="h-4 w-4 shrink-0" /> Message hidden: it only contained contact details.
          </span>
        ) : (
          <Redacted text={m.content} />
        )}
      </div>
      <p className="mt-1 px-1 text-[11px] text-muted">
        {time}
        {mine && showRead && (m.read_at ? " · Read" : " · Sent")}
      </p>
      {m.moderation_warning && (
        <div className="mb-1 mt-1 flex w-full max-w-[85%] items-start gap-2 self-center rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 sm:max-w-[70%]">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            <b>Airbnb Trust &amp; Safety</b> · {m.moderation_warning}
          </span>
        </div>
      )}
    </div>
  );
}

function Composer({ conversationId, onSent }: { conversationId: number; onSent: (m: Message) => void }) {
  const { toast } = useApp();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [serverBlock, setServerBlock] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft("");
    setServerBlock(null);
  }, [conversationId]);

  // grow with the text, up to ~6 lines
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const guard = useMemo(() => checkMessage(draft), [draft]);
  const length = [...draft].length;
  const tooLong = length > MAX_MESSAGE_LENGTH;
  const canSend = draft.trim().length > 0 && guard.level !== "blocked" && !tooLong && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const m = await api.sendMessage(conversationId, draft.trim());
      onSent(m);
      setDraft("");
      setServerBlock(null);
      if (m.raw_attempted_flag) toast("Some details were hidden by Airbnb for safety", "info");
    } catch (e) {
      if (e instanceof ApiError && e.code === "CONTACT_INFO_PROHIBITED") setServerBlock(e.message);
      else toast(e instanceof Error ? e.message : "Couldn't send your message", "error");
    } finally {
      setSending(false);
      area.current?.focus();
    }
  };

  const warn = guard.level !== "ok" || serverBlock;
  return (
    <div className="border-t border-line bg-white px-4 pb-4 pt-3 md:px-6">
      {warn && (
        <div
          role="alert"
          className={`mb-3 flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm leading-5 ${
            guard.level === "blocked" || serverBlock ? "border-rose-200 bg-rose-50 text-rose-900" : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          <span aria-hidden className="text-base leading-5">🛡️</span>
          <div>
            <p>{SAFETY_WARNING}</p>
            <p className="mt-1 text-xs font-semibold">
              {serverBlock
                ? serverBlock
                : guard.level === "blocked"
                  ? `Remove the ${guard.reasons.join(", ")} to send this message.`
                  : `If you send this, the ${guard.reasons.join(" and ")} will be replaced with “${PLACEHOLDER}”.`}
            </p>
          </div>
        </div>
      )}
      <div className="flex items-end gap-3 rounded-3xl border border-gray-300 px-4 py-2 focus-within:border-ink">
        <textarea
          ref={area}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setServerBlock(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Write a message…"
          aria-label="Message"
          className="max-h-40 flex-1 resize-none bg-transparent py-1.5 leading-6 outline-none"
        />
        <button
          onClick={send}
          disabled={!canSend}
          aria-label="Send"
          className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white transition disabled:bg-gray-200 disabled:text-gray-400"
        >
          <SendHorizontal className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-1.5 flex justify-between px-2 text-[11px] text-muted">
        <span>Enter to send · Shift + Enter for a new line</span>
        <span className={tooLong ? "font-semibold text-brand" : ""}>
          {length.toLocaleString("en-IN")} / {MAX_MESSAGE_LENGTH.toLocaleString("en-IN")}
        </span>
      </div>
    </div>
  );
}

function ContextPanel({ c, bare = false }: { c: ConversationDetail; bare?: boolean }) {
  const r = c.reservation;
  const isGuest = c.role === "guest";
  const listing = c.listing;
  return (
    <div className={bare ? "" : "p-6"}>
      {!bare && <h2 className="text-lg font-semibold">{r ? "Reservation" : "About this inquiry"}</h2>}
      {listing ? (
        <Link href={listingHref(listing)} className={`${bare ? "" : "mt-4"} block overflow-hidden rounded-2xl border border-line`}>
          <SafeImage
            src={listing.photo ?? ""}
            seed={`ctx-${listing.type}-${listing.id}`}
            alt=""
            className={`h-44 w-full object-cover ${r?.status.startsWith("cancelled") ? "opacity-60 grayscale" : ""}`}
          />
          <div className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {TYPE_LABEL[listing.type]} · {listing.city}, {listing.country}
            </p>
            <p className="mt-1 font-semibold leading-snug">{listing.title}</p>
          </div>
        </Link>
      ) : (
        <p className="mt-4 rounded-xl bg-soft p-4 text-sm text-muted">This listing has been removed by the host.</p>
      )}

      <div className="mt-5 flex items-center justify-between">
        <p className="font-semibold">Status</p>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS[c.status].style}`}>{STATUS[c.status].label}</span>
      </div>

      {r ? (
        <dl className="mt-4 space-y-3 border-t border-line pt-4 text-sm">
          <Row label={r.check_in ? "Dates" : "When"}>
            {r.check_in && r.check_out ? (
              formatRange(r.check_in, r.check_out)
            ) : r.starts_at && r.ends_at ? (
              <>
                {formatSlotDay(r.starts_at)}
                <span className="block text-muted">{formatTimeRange(r.starts_at, r.ends_at)}</span>
              </>
            ) : null}
          </Row>
          <Row label="Guests">{plural(r.guests, "guest")}</Row>
          <Row label={r.status.startsWith("cancelled") ? "Refunded" : isGuest ? "Total paid" : "Booking total"}>{formatPrice(r.total_price)}</Row>
          <Row label="Reservation">#{r.id}</Row>
        </dl>
      ) : (
        <p className="mt-4 border-t border-line pt-4 text-sm text-muted">
          {isGuest
            ? "You haven't booked yet. Ask anything before you reserve; payment only happens through Airbnb."
            : "This guest hasn't booked yet. Answer their questions here so they can book with confidence."}
        </p>
      )}

      {c.status === "cancelled_by_host" && (
        <div className="mt-4 flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <p>
            {isGuest ? `Your host ${c.counterpart.name} cancelled this reservation.` : "You cancelled this reservation."} A full refund
            {r ? ` of ${formatPrice(r.total_price)}` : ""} has been initiated.
          </p>
        </div>
      )}

      <div className="mt-6 space-y-2">
        {listing && !r && isGuest && (
          <Link href={listingHref(listing)} className="block rounded-lg bg-brand px-4 py-3 text-center font-semibold text-white">
            {listing.type === "home" ? "Check availability" : "See dates"}
          </Link>
        )}
        <Link
          href={isGuest ? "/trips" : "/host?tab=reservations"}
          className="block rounded-lg border border-ink px-4 py-3 text-center font-semibold hover:bg-soft"
        >
          {isGuest ? "View your trips" : "View reservations"}
        </Link>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}
