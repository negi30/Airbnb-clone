"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe } from "lucide-react";

const COLUMNS = [
  { title: "Support", links: ["Help Centre", "Get help with a safety issue", "AirCover", "Anti-discrimination", "Disability support", "Cancellation options"] },
  { title: "Hosting", links: ["Airbnb your home", "AirCover for Hosts", "Hosting resources", "Community forum", "Hosting responsibly", "Join a free Hosting class"] },
  { title: "Airbnb", links: ["Newsroom", "New features", "Careers", "Investors", "Gift cards", "Emergency stays"] },
];

/** Footer entries that have a real page in this clone. */
const LINKS: Record<string, string> = {
  "Cancellation options": "/trips",
  "Airbnb your home": "/host",
  "Hosting resources": "/host",
};

export default function Footer() {
  // the inbox fills the viewport, like Airbnb's
  if (usePathname().endsWith("/messages")) return null;
  return (
    <footer className="mt-16 border-t border-line bg-soft">
      <div className="mx-auto grid max-w-[1760px] gap-8 px-6 py-12 md:grid-cols-3 md:px-10 xl:px-20">
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h4 className="mb-4 text-sm font-semibold">{col.title}</h4>
            <ul className="space-y-3 text-sm text-ink">
              {col.links.map((l) => (
                <li key={l}>
                  {LINKS[l] ? (
                    <Link href={LINKS[l]} className="hover:underline">
                      {l}
                    </Link>
                  ) : (
                    // no page behind these in the clone, so they aren't links that lead nowhere
                    <span className="text-muted">{l}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-[1760px] flex-col justify-between gap-3 border-t border-line px-6 py-6 text-sm md:flex-row md:px-10 xl:px-20">
        <p>© 2026 Airbnb, Inc. · Privacy · Terms · Sitemap · Built as an Airbnb clone for learning purposes</p>
        <p className="flex items-center gap-4 font-semibold">
          <span className="flex items-center gap-2">
            <Globe className="h-4 w-4" /> English (IN)
          </span>
          <span>₹ INR</span>
        </p>
      </div>
    </footer>
  );
}
