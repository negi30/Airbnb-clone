"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, getStoredUserId, setStoredUserId } from "@/lib/api";
import type { User } from "@/lib/types";
import { CheckCircle2, XCircle, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  image?: string;
}

interface AppState {
  user: User | null;
  users: User[];
  switchUser: (id: number) => void;
  wishlistIds: Set<number>;
  toggleWishlist: (listingId: number, meta?: { title?: string; image?: string }) => Promise<void>;
  savedExperienceIds: Set<number>;
  toggleSavedExperience: (experienceId: number, meta?: { image?: string }) => Promise<void>;
  toast: (message: string, kind?: ToastKind, image?: string) => void;
}

const AppContext = createContext<AppState | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [wishlistIds, setWishlistIds] = useState<Set<number>>(new Set());
  const [savedExperienceIds, setSavedExperienceIds] = useState<Set<number>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextToastId = useRef(1);

  const toast = useCallback((message: string, kind: ToastKind = "success", image?: string) => {
    const id = nextToastId.current++;
    setToasts((t) => [...t, { id, message, kind, image }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  // Load accounts and restore the active one (default: first guest). A free-tier backend can take
  // ~a minute to wake up, so keep retrying with backoff instead of giving up after one failure.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const attempt = (n: number) =>
      api
        .users()
        .then((list) => {
          if (cancelled) return;
          setUsers(list);
          const stored = getStoredUserId();
          const active = list.find((u) => u.id === stored) ?? list.find((u) => !u.is_host) ?? list[0];
          if (active) {
            setStoredUserId(active.id);
            setUser(active);
          }
        })
        .catch(() => {
          if (cancelled) return;
          if (n === 0) toast("Waking up the server… this can take a minute", "info");
          if (n === 6) toast("Can't reach the API. Is the backend running?", "error");
          timer = window.setTimeout(() => attempt(n + 1), Math.min(2000 * 2 ** n, 15000));
        });
    attempt(0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [toast]);

  // Wishlist follows the active account (cleared first so the previous one's hearts never show)
  useEffect(() => {
    if (!user) return;
    let stale = false;
    setWishlistIds(new Set());
    setSavedExperienceIds(new Set());
    api
      .wishlistIds()
      .then((ids) => !stale && setWishlistIds(new Set(ids)))
      .catch(() => undefined);
    api
      .savedExperienceIds()
      .then((ids) => !stale && setSavedExperienceIds(new Set(ids)))
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [user]);

  // one request per heart at a time, so a double-click can't fire add + add (or add + remove) out of order
  const pendingHearts = useRef(new Set<string>());

  const switchUser = useCallback(
    (id: number) => {
      const next = users.find((u) => u.id === id);
      if (!next) return;
      setStoredUserId(id);
      setUser(next);
      toast(`Switched to ${next.name}${next.is_host ? " (host)" : ""}`, "info", next.avatar_url ?? undefined);
    },
    [users, toast],
  );

  const toggleWishlist = useCallback(
    async (listingId: number, meta?: { title?: string; image?: string }) => {
      const key = `home-${listingId}`;
      if (pendingHearts.current.has(key)) return;
      pendingHearts.current.add(key);
      const saved = wishlistIds.has(listingId);
      // optimistic update, rolled back on failure
      setWishlistIds((prev) => {
        const next = new Set(prev);
        if (saved) next.delete(listingId);
        else next.add(listingId);
        return next;
      });
      try {
        if (saved) await api.removeFromWishlist(listingId);
        else await api.addToWishlist(listingId);
        toast(saved ? "Removed from Wishlist" : "Saved to Wishlist", "success", meta?.image);
      } catch {
        setWishlistIds((prev) => {
          const next = new Set(prev);
          if (saved) next.add(listingId);
          else next.delete(listingId);
          return next;
        });
        toast("Couldn't update your wishlist", "error");
      } finally {
        pendingHearts.current.delete(key);
      }
    },
    [wishlistIds, toast],
  );

  const toggleSavedExperience = useCallback(
    async (experienceId: number, meta?: { image?: string }) => {
      const key = `exp-${experienceId}`;
      if (pendingHearts.current.has(key)) return;
      pendingHearts.current.add(key);
      const saved = savedExperienceIds.has(experienceId);
      const flip = (add: boolean) =>
        setSavedExperienceIds((prev) => {
          const next = new Set(prev);
          if (add) next.add(experienceId);
          else next.delete(experienceId);
          return next;
        });
      flip(!saved); // optimistic, rolled back on failure
      try {
        if (saved) await api.unsaveExperience(experienceId);
        else await api.saveExperience(experienceId);
        toast(saved ? "Removed from Wishlist" : "Saved to Wishlist", "success", meta?.image);
      } catch {
        flip(saved);
        toast("Couldn't update your wishlist", "error");
      } finally {
        pendingHearts.current.delete(key);
      }
    },
    [savedExperienceIds, toast],
  );

  const value = useMemo(
    () => ({ user, users, switchUser, wishlistIds, toggleWishlist, savedExperienceIds, toggleSavedExperience, toast }),
    [user, users, switchUser, wishlistIds, toggleWishlist, savedExperienceIds, toggleSavedExperience, toast],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[100] flex w-[calc(100%-32px)] max-w-sm -translate-x-1/2 flex-col gap-3 md:left-6 md:translate-x-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast-in pointer-events-auto flex items-center gap-3 rounded-xl bg-white p-3 pr-4 shadow-[0_6px_20px_rgba(0,0,0,0.2)]"
          >
            {t.image ? (
              <img src={t.image} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
            ) : t.kind === "error" ? (
              <XCircle className="h-6 w-6 shrink-0 text-brand" />
            ) : (
              <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
            )}
            <p className="flex-1 text-sm font-semibold text-ink">{t.message}</p>
            <button
              aria-label="Dismiss"
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
              className="rounded-full p-1 hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}
