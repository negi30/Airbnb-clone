"use client";

import { Suspense } from "react";
import ExperiencesBrowse from "@/components/ExperiencesBrowse";

export default function ServicesPage() {
  return (
    <Suspense fallback={null}>
      <ExperiencesBrowse kind="service" />
    </Suspense>
  );
}
