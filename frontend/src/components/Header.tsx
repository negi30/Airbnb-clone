"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, Menu, Search } from "lucide-react";
import SearchBar from "./SearchBar";
import { Avatar, Logo, Modal } from "./ui";
import { useApp } from "@/context/AppProvider";
import { api, MESSAGES_READ_EVENT } from "@/lib/api";
import { formatRange, formatShortDate } from "@/lib/format";

const NAV = [
  { href: "/all", label: "All", icon: "🌍", active: (p: string) => p === "/all" },
  { href: "/", label: "Homes", icon: "🏡", active: (p: string) => p === "/" },
  { href: "/experiences", label: "Experiences", icon: "🎈", active: (p: string) => p.startsWith("/experiences") },
  { href: "/services", label: "Services", icon: "🛎️", active: (p: string) => p.startsWith("/services") },
];

export default function Header() {
  const pathname = usePathname();
  const params = useSearchParams();
  const isHome = pathname === "/";
  const [expanded, setExpanded] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // collapse the expanded search whenever the route/query changes
  useEffect(() => setExpanded(false), [pathname, params]);

  const isNavPage = ["/", "/all", "/experiences", "/services"].includes(pathname);
  // Experiences & services search a single day and stay inside their own section
  const basePath = pathname.startsWith("/services") ? "/services" : pathname.startsWith("/experiences") ? "/experiences" : undefined;
  const day = params.get("date");
  const showFullSearch = (isNavPage && !scrolled) || expanded;
  const loc = params.get("location");
  const ci = params.get("check_in");
  const co = params.get("check_out");
  const guests = params.get("guests");

  return (
    <>
      <header className={`${isNavPage ? "sticky top-0" : "relative"} z-40 border-b border-line bg-white`}>
        <div className="mx-auto flex h-20 max-w-[1760px] items-center justify-between gap-4 px-6 md:px-10 xl:px-20">
          <Link href="/" className="flex-1 basis-0" aria-label="Home">
            <Logo />
          </Link>

          {/* compact pill (desktop) */}
          <div className="hidden md:block">
            {showFullSearch ? (
              <nav className="flex gap-8 text-base">
                {NAV.map(({ href, label, icon, active }) => (
                  <Link key={href} href={href} className={`flex items-center gap-2 pb-1 ${active(pathname) ? "border-b-2 border-ink font-semibold" : "text-muted hover:text-ink"}`}>
                    <span aria-hidden className="text-[28px] leading-none">{icon}</span>
                    {label}
                  </Link>
                ))}
              </nav>
            ) : (
              <button
                onClick={() => setExpanded(true)}
                className="flex items-center rounded-full border border-line py-2 pl-6 pr-2 text-sm shadow-search transition hover:shadow-card"
              >
                <span className="font-semibold">{loc || "Anywhere"}</span>
                <span className="mx-4 h-6 w-px bg-line" />
                <span className="font-semibold">
                  {basePath ? (day ? formatShortDate(day) : "Anytime") : ci && co ? formatRange(ci, co) : "Any week"}
                </span>
                <span className="mx-4 h-6 w-px bg-line" />
                <span className={guests ? "font-semibold" : "text-muted"}>{guests ? `${guests} guest${guests === "1" ? "" : "s"}` : "Add guests"}</span>
                <span className="ml-3 flex h-8 w-8 items-center justify-center rounded-full bg-brand text-white">
                  <Search className="h-3.5 w-3.5" strokeWidth={3} />
                </span>
              </button>
            )}
          </div>

          {/* mobile pill */}
          <button
            onClick={() => setMobileSearch(true)}
            className="flex flex-[3] items-center gap-3 rounded-full border border-line px-5 py-2.5 text-left shadow-search md:hidden"
          >
            <Search className="h-4 w-4" />
            <span className="text-sm font-semibold">{loc || "Start your search"}</span>
          </button>

          <div className="flex flex-1 basis-0 items-center justify-end gap-1">
            <UserMenu />
          </div>
        </div>

        {showFullSearch && (
          <div className="hidden px-6 pb-6 md:block">
            <SearchBar key={basePath ?? "/"} basePath={basePath} />
          </div>
        )}
      </header>
      {expanded && !isHome && <div className="fixed inset-0 z-30 bg-black/25" onClick={() => setExpanded(false)} />}

      <Modal open={mobileSearch} onClose={() => setMobileSearch(false)} title="Search">
        <SearchBar key={basePath ?? "/"} stacked basePath={basePath} onDone={() => setMobileSearch(false)} />
      </Modal>
    </>
  );
}

function UserMenu() {
  const { user, users, switchUser } = useApp();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  // unread badge: refresh on navigation, when the inbox marks a thread read, and every 30s
  useEffect(() => {
    if (!user) return;
    let stale = false; // after an account switch, the previous account's count must not land
    const refresh = () => api.unreadCount().then((r) => !stale && setUnread(r.count)).catch(() => undefined);
    refresh();
    const id = window.setInterval(() => document.visibilityState === "visible" && refresh(), 30000);
    window.addEventListener(MESSAGES_READ_EVENT, refresh);
    return () => {
      stale = true;
      window.clearInterval(id);
      window.removeEventListener(MESSAGES_READ_EVENT, refresh);
    };
  }, [user, pathname]);
  useEffect(() => setUnread(0), [user]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const item = "block w-full px-4 py-3 text-left text-sm hover:bg-soft";
  // already in hosting mode: no "Switch to hosting" link
  const inHostMode = pathname.startsWith("/host");

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      {!inHostMode && (
        <Link
          href="/host"
          className="hidden rounded-full px-4 py-3 text-sm font-semibold hover:bg-soft lg:block"
        >
          {user?.is_host ? "Switch to hosting" : "Become a host"}
        </Link>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        className="flex items-center gap-3 rounded-full border border-line py-1.5 pl-3.5 pr-1.5 transition hover:shadow-card"
      >
        <Menu className="h-4 w-4" />
        <span className="relative">
          <Avatar src={user?.avatar_url} name={user?.name ?? "?"} size={30} />
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-brand px-1 text-[10px] font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-72 overflow-hidden rounded-xl bg-white py-2 shadow-card">
          {user && (
            <div className="border-b border-line px-4 pb-3 pt-1">
              <p className="text-xs text-muted">Signed in as</p>
              <p className="text-sm font-semibold">
                {user.name} {user.is_host && <span className="font-normal text-muted">· Host</span>}
              </p>
            </div>
          )}
          <div className="border-b border-line py-1" onClick={() => setOpen(false)}>
            <Link href="/wishlists" className={`${item} font-semibold`}>Wishlists</Link>
            <Link href="/trips" className={`${item} font-semibold`}>Trips</Link>
            <Link href="/messages" className={`${item} flex items-center justify-between font-semibold`}>
              Messages
              {unread > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">{unread}</span>}
            </Link>
          </div>
          <div className="border-b border-line py-1" onClick={() => setOpen(false)}>
            <Link href="/host" className={item}>{user?.is_host ? "Host dashboard" : "Airbnb your home"}</Link>
            {user?.is_host && (
              <>
                <Link href="/host/messages" className={item}>Host messages</Link>
                <Link href="/host/listings/new" className={item}>List a home</Link>
                <Link href="/host/experiences/new?kind=experience" className={item}>Host an experience</Link>
                <Link href="/host/experiences/new?kind=service" className={item}>Offer a service</Link>
              </>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            <p className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">Switch account (demo)</p>
            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => {
                  switchUser(u.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-soft"
              >
                <Avatar src={u.avatar_url} name={u.name} size={28} />
                <span className="flex-1">
                  {u.name}
                  <span className="block text-xs text-muted">{u.is_host ? (u.is_superhost ? "Superhost" : "Host") : "Guest"}</span>
                </span>
                {u.id === user?.id && <Check className="h-4 w-4" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
