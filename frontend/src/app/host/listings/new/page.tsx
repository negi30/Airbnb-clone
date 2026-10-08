"use client";

import Link from "next/link";
import ListingForm from "@/components/ListingForm";
import { Spinner } from "@/components/ui";
import { useApp } from "@/context/AppProvider";

export default function NewListingPage() {
  const { user } = useApp();
  if (!user) return <Spinner />;
  if (!user.is_host)
    return (
      <div className="py-32 text-center">
        <p className="text-lg font-semibold">Switch to a host account to create listings.</p>
        <Link href="/host" className="mt-3 inline-block underline">Go to hosting</Link>
      </div>
    );
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-10 text-[32px] font-semibold">Create a new listing</h1>
      <ListingForm />
    </div>
  );
}
