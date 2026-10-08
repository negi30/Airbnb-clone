"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, X } from "lucide-react";
import { BrandButton, Counter, SafeImage } from "./ui";
import { useApp } from "@/context/AppProvider";
import { api } from "@/lib/api";
import { amenityIcon, categoryIcon } from "@/lib/icons";
import type { Amenity, Category, ListingInput } from "@/lib/types";

const EMPTY: ListingInput = {
  title: "",
  description: "",
  property_type: "House",
  category: "Trending",
  city: "",
  state: "",
  country: "India",
  latitude: 20.5937,
  longitude: 78.9629,
  price_per_night: 4000,
  cleaning_fee: 500,
  max_guests: 2,
  bedrooms: 1,
  beds: 1,
  bathrooms: 1,
  amenity_ids: [],
  photo_urls: [],
};

const MAX_PHOTOS = 20;
const MAX_UPLOAD_MB = 5;

export default function ListingForm({ initial, listingId }: { initial?: ListingInput; listingId?: number }) {
  const router = useRouter();
  const { toast } = useApp();
  const [form, setForm] = useState<ListingInput>(initial ?? EMPTY);
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [photoUrl, setPhotoUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    api.amenities().then(setAmenities).catch(() => {});
    api.categories().then(setCategories).catch(() => {});
    api.propertyTypes().then(setTypes).catch(() => {});
  }, []);

  const set = <K extends keyof ListingInput>(key: K, value: ListingInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  function validate() {
    const e: Record<string, string> = {};
    if (form.title.trim().length < 5) e.title = "Title must be at least 5 characters";
    if (form.description.trim().length < 20) e.description = "Description must be at least 20 characters";
    if (!form.city.trim()) e.city = "City is required";
    if (!form.country.trim()) e.country = "Country is required";
    // the API takes whole rupees (int) up to 10 lakh a night
    if (!Number.isInteger(form.price_per_night) || form.price_per_night <= 0 || form.price_per_night > 1_000_000)
      e.price_per_night = "Enter a whole number between ₹1 and ₹10,00,000";
    if (!Number.isInteger(form.cleaning_fee) || form.cleaning_fee < 0) e.cleaning_fee = "Enter a whole number (0 for none)";
    if (!Number.isFinite(form.latitude) || Math.abs(form.latitude) > 90) e.latitude = "Latitude must be between -90 and 90";
    if (!Number.isFinite(form.longitude) || Math.abs(form.longitude) > 180) e.longitude = "Longitude must be between -180 and 180";
    if (form.photo_urls.length === 0) e.photos = "Add at least one photo";
    if (form.photo_urls.length > MAX_PHOTOS) e.photos = `Use at most ${MAX_PHOTOS} photos`;
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) {
      toast("Please fix the highlighted fields", "error");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, state: form.state || null };
      const saved = listingId ? await api.updateListing(listingId, payload) : await api.createListing(payload);
      toast(listingId ? "Listing updated" : "Your listing is live!", "success", saved.photos[0]);
      router.push(`/listings/${saved.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save listing", "error");
    } finally {
      setSaving(false);
    }
  }

  function addUrl() {
    const url = photoUrl.trim();
    if (!/^https?:\/\/\S+$/.test(url)) {
      toast("Enter a valid image URL (https://…)", "error");
      return;
    }
    if (form.photo_urls.length >= MAX_PHOTOS) {
      toast(`You can add up to ${MAX_PHOTOS} photos`, "error");
      return;
    }
    set("photo_urls", [...form.photo_urls, url]);
    setPhotoUrl("");
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
          toast(`${file.name} is over ${MAX_UPLOAD_MB} MB`, "error");
          continue;
        }
        const { url } = await api.uploadImage(file);
        setForm((f) => ({ ...f, photo_urls: [...f.photo_urls, url] }));
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Upload failed", "error");
    } finally {
      setUploading(false);
    }
  }

  const input = "w-full rounded-lg border border-gray-400 px-4 py-3 outline-none focus:border-ink focus:ring-1 focus:ring-ink";
  const label = "mb-1.5 block text-sm font-semibold";
  const err = (k: string) => errors[k] && <p className="mt-1 text-sm text-brand">{errors[k]}</p>;

  return (
    <form onSubmit={submit} className="space-y-12">
      <section>
        <h2 className="text-[22px] font-semibold">Which of these best describes your place?</h2>
        <div className="mt-5 flex flex-wrap gap-2">
          {types.map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => set("property_type", t)}
              className={`rounded-xl border px-5 py-3 font-semibold ${form.property_type === t ? "border-2 border-ink bg-soft" : "border-line hover:border-ink"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <p className={`${label} mt-6`}>Category</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {categories.map((c) => {
            const Icon = categoryIcon(c.name);
            return (
              <button
                type="button"
                key={c.name}
                onClick={() => set("category", c.name)}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left text-sm font-semibold ${
                  form.category === c.name ? "border-2 border-ink bg-soft" : "border-line hover:border-ink"
                }`}
              >
                <Icon className="h-5 w-5" /> {c.name}
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-5">
        <h2 className="text-[22px] font-semibold">Title and description</h2>
        <div>
          <label className={label}>Title</label>
          <input className={input} value={form.title} maxLength={200} onChange={(e) => set("title", e.target.value)} placeholder="Sunny loft with a rooftop terrace" />
          {err("title")}
        </div>
        <div>
          <label className={label}>Description</label>
          <textarea className={input} rows={6} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Tell guests what makes your place special" />
          {err("description")}
        </div>
      </section>

      <section>
        <h2 className="text-[22px] font-semibold">Where&apos;s your place located?</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <div>
            <label className={label}>City</label>
            <input className={input} value={form.city} onChange={(e) => set("city", e.target.value)} />
            {err("city")}
          </div>
          <div>
            <label className={label}>State / region</label>
            <input className={input} value={form.state ?? ""} onChange={(e) => set("state", e.target.value)} />
          </div>
          <div>
            <label className={label}>Country</label>
            <input className={input} value={form.country} onChange={(e) => set("country", e.target.value)} />
            {err("country")}
          </div>
          <div>
            <label className={label}>Latitude</label>
            <input className={input} type="number" step="any" min={-90} max={90} value={form.latitude} onChange={(e) => set("latitude", Number(e.target.value))} />
            {err("latitude")}
          </div>
          <div>
            <label className={label}>Longitude</label>
            <input className={input} type="number" step="any" min={-180} max={180} value={form.longitude} onChange={(e) => set("longitude", Number(e.target.value))} />
            {err("longitude")}
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-[22px] font-semibold">Share some basics</h2>
        <div className="mt-4 max-w-md divide-y divide-line">
          {([
            ["max_guests", "Guests", 1, 50],
            ["bedrooms", "Bedrooms", 0, 50],
            ["beds", "Beds", 1, 100],
            ["bathrooms", "Bathrooms", 1, 50],
          ] as const).map(([key, text, min, max]) => (
            <div key={key} className="flex items-center justify-between py-4">
              <span>{text}</span>
              <Counter value={form[key]} onChange={(v) => set(key, v)} min={min} max={max} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-[22px] font-semibold">What does your place offer?</h2>
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {amenities.map((a) => {
            const Icon = amenityIcon(a.icon);
            const on = form.amenity_ids.includes(a.id);
            return (
              <button
                type="button"
                key={a.id}
                onClick={() => set("amenity_ids", on ? form.amenity_ids.filter((x) => x !== a.id) : [...form.amenity_ids, a.id])}
                className={`flex items-center gap-3 rounded-xl border p-4 text-left text-sm font-semibold ${on ? "border-2 border-ink bg-soft" : "border-line hover:border-ink"}`}
              >
                <Icon className="h-6 w-6" strokeWidth={1.5} /> {a.name}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-[22px] font-semibold">Add some photos</h2>
        <p className="mt-1 text-sm text-muted">Paste image URLs or upload files. The first photo is your cover.</p>
        <div className="mt-5 flex gap-2">
          <input
            className={input}
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addUrl();
              }
            }}
            placeholder="https://images.unsplash.com/…"
          />
          <button type="button" onClick={addUrl} className="shrink-0 rounded-lg border border-ink px-5 font-semibold hover:bg-soft">
            Add
          </button>
        </div>
        <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 py-8 text-sm font-semibold hover:border-ink">
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
          {uploading ? "Uploading…" : "Upload from your device"}
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={uploading}
            onChange={(e) => {
              upload(e.target.files);
              e.target.value = ""; // so picking the same file again still uploads it
            }}
          />
        </label>
        {err("photos")}
        {form.photo_urls.length > 0 && (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {form.photo_urls.map((url, i) => (
              <div key={`${url}-${i}`} className="relative">
                <SafeImage src={url} seed={i} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" />
                {i === 0 && <span className="absolute left-2 top-2 rounded bg-white px-2 py-0.5 text-xs font-semibold">Cover photo</span>}
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => set("photo_urls", form.photo_urls.filter((_, j) => j !== i))}
                  className="absolute right-2 top-2 rounded-full bg-white p-1 shadow"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[22px] font-semibold">Now, set your price</h2>
        <div className="mt-5 grid max-w-md grid-cols-2 gap-4">
          <div>
            <label className={label}>Price per night (₹)</label>
            <input className={input} type="number" min={1} step={1} value={form.price_per_night} onChange={(e) => set("price_per_night", Number(e.target.value))} />
            {err("price_per_night")}
          </div>
          <div>
            <label className={label}>Cleaning fee (₹)</label>
            <input className={input} type="number" min={0} step={1} value={form.cleaning_fee} onChange={(e) => set("cleaning_fee", Number(e.target.value))} />
            {err("cleaning_fee")}
          </div>
        </div>
      </section>

      <div className="sticky bottom-0 -mx-6 flex justify-between border-t border-line bg-white px-6 py-4">
        <button type="button" onClick={() => router.back()} className="font-semibold underline">
          Cancel
        </button>
        <BrandButton type="submit" disabled={saving || uploading}>
          {saving ? "Saving…" : listingId ? "Save changes" : "Publish listing"}
        </BrandButton>
      </div>
    </form>
  );
}
