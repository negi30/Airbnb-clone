"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ExperienceForm from "@/components/ExperienceForm";
import { Spinner } from "@/components/ui";
import { useApp } from "@/context/AppProvider";
import { ApiError, api } from "@/lib/api";
import type { ExperienceInput } from "@/lib/types";

export default function EditExperiencePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useApp();
  const [initial, setInitial] = useState<ExperienceInput | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    // re-check ownership from scratch after an account switch
    setError(null);
    setInitial(null);
    api
      .hostExperienceForm(Number(id))
      .then(setInitial) // the extra `id` is ignored by the API on save
      .catch((e) =>
        setError(
          e instanceof ApiError && e.status === 403
            ? "You can only edit your own experiences and services. Switch to the host account that owns it."
            : e instanceof Error ? e.message : "Not found",
        ),
      );
  }, [id, user]);

  if (error) return <p className="py-32 text-center text-lg font-semibold">{error}</p>;
  if (!initial) return <Spinner />;
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-10 text-[32px] font-semibold">Edit {initial.kind}</h1>
      <ExperienceForm kind={initial.kind} initial={initial} experienceId={Number(id)} />
    </div>
  );
}
