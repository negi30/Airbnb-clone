"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { useApp } from "@/context/AppProvider";
import { api } from "@/lib/api";
import type { ListingType } from "@/lib/types";

interface Props {
  listingType: ListingType;
  listingId?: number;
  /** open the thread tied to this trip / reservation (either side may start it) */
  reservationId?: number;
  label: string;
  /** "solid" dark button, "link" underlined text, "icon" round icon button */
  variant?: "solid" | "link" | "icon";
  className?: string;
}

/** "Message host" / "Message guest": get-or-create the thread, then open it in the right inbox. */
export default function MessageButton({ listingType, listingId, reservationId, label, variant = "solid", className = "" }: Props) {
  const { user, toast } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!user || busy) return;
    setBusy(true);
    try {
      const c = await api.startConversation({ listing_type: listingType, listing_id: listingId, reservation_id: reservationId });
      router.push(`${c.role === "host" ? "/host/messages" : "/messages"}?c=${c.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't open the conversation", "error");
      setBusy(false);
    }
  };

  if (variant === "icon")
    return (
      <button onClick={start} disabled={busy} aria-label={label} title={label} className={`rounded-full p-2 hover:bg-gray-200 disabled:opacity-50 ${className}`}>
        <MessageSquare className="h-4 w-4" />
      </button>
    );
  if (variant === "link")
    return (
      <button onClick={start} disabled={busy} className={`text-sm font-semibold underline disabled:opacity-50 ${className}`}>
        {busy ? "Opening…" : label}
      </button>
    );
  return (
    <button onClick={start} disabled={busy} className={`inline-flex items-center gap-2 rounded-lg bg-ink px-6 py-3 font-semibold text-white disabled:opacity-60 ${className}`}>
      <MessageSquare className="h-4 w-4" /> {busy ? "Opening…" : label}
    </button>
  );
}
