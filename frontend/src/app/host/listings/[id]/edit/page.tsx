"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ListingForm from "@/components/ListingForm";
import { Spinner } from "@/components/ui";
import { useApp } from "@/context/AppProvider";
import { api } from "@/lib/api";
import type { ListingInput } from "@/lib/types";

export default function EditListingPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useApp();
  const [initial, setInitial] = useState<ListingInput | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    // re-check ownership from scratch after an account switch
    setError(null);
    setInitial(null);
    api
      .listing(Number(id))
      .then((l) => {
        if (l.host.id !== user.id) {
          setError("You can only edit your own listings. Switch to the host account that owns it.");
          return;
        }
        setInitial({
          title: l.title,
          description: l.description,
          property_type: l.property_type,
          category: l.category,
          city: l.city,
          state: l.state,
          country: l.country,
          latitude: l.latitude,
          longitude: l.longitude,
          price_per_night: l.price_per_night,
          cleaning_fee: l.cleaning_fee,
          max_guests: l.max_guests,
          bedrooms: l.bedrooms,
          beds: l.beds,
          bathrooms: l.bathrooms,
          amenity_ids: l.amenities.map((a) => a.id),
          photo_urls: l.photos,
        });
      })
      .catch(() => setError("Listing not found"));
  }, [id, user]);

  if (error) return <p className="py-32 text-center text-lg font-semibold">{error}</p>;
  if (!initial) return <Spinner />;
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-10 text-[32px] font-semibold">Edit listing</h1>
      <ListingForm initial={initial} listingId={Number(id)} />
    </div>
  );
}
