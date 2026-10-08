"use client";

import { Suspense } from "react";
import ExperienceDetailView from "@/components/ExperienceDetailView";
import { Spinner } from "@/components/ui";

export default function ExperienceDetailPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ExperienceDetailView kind="experience" />
    </Suspense>
  );
}
