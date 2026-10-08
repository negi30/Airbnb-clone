"use client";

import { Suspense } from "react";
import ExperiencesBrowse from "@/components/ExperiencesBrowse";

export default function ExperiencesPage() {
  return (
    <Suspense fallback={null}>
      <ExperiencesBrowse kind="experience" />
    </Suspense>
  );
}
