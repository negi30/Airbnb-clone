"use client";

import { Suspense } from "react";
import Link from "next/link";
import Inbox from "@/components/Inbox";
import { Spinner } from "@/components/ui";
import { useApp } from "@/context/AppProvider";

export default function HostMessagesPage() {
  const { user } = useApp();
  if (!user) return <Spinner />;
  if (!user.is_host)
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="text-[28px] font-semibold">Hosting inbox</h1>
        <p className="mt-2 text-muted">Switch to a host account to see messages from your guests.</p>
        <Link href="/messages" className="mt-6 inline-block rounded-lg bg-ink px-6 py-3 font-semibold text-white">Go to your messages</Link>
      </div>
    );
  return (
    <Suspense fallback={<Spinner />}>
      <Inbox scope="host" />
    </Suspense>
  );
}
