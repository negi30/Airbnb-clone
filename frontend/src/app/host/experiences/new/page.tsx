"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import ExperienceForm from "@/components/ExperienceForm";
import { Spinner } from "@/components/ui";
import { useApp } from "@/context/AppProvider";

export default function NewExperiencePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <NewExperience />
    </Suspense>
  );
}

function NewExperience() {
  const { user } = useApp();
  const kind = useSearchParams().get("kind") === "service" ? "service" : "experience";
  if (!user) return <Spinner />;
  if (!user.is_host)
    return (
      <div className="py-32 text-center">
        <p className="text-lg font-semibold">Switch to a host account to create {kind}s.</p>
        <Link href="/host" className="mt-3 inline-block underline">Go to hosting</Link>
      </div>
    );
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-10 text-[32px] font-semibold">Create a new {kind}</h1>
      <ExperienceForm key={kind} kind={kind} />
    </div>
  );
}
