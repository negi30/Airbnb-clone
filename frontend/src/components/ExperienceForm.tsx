"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Plus, X } from "lucide-react";
import { BrandButton, Counter, SafeImage } from "./ui";
import { experienceHref } from "./ExperienceCard";
import { useApp } from "@/context/AppProvider";
import { api } from "@/lib/api";
import { formatDuration, formatTime } from "@/lib/format";
import type { Category, ExperienceInput, ExperienceKind } from "@/lib/types";

const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480];
// limits enforced by the API (schemas.ExperienceIn)
const MAX_PHOTOS = 20;
const MAX_START_TIMES = 8;
const MAX_UPLOAD_MB = 5;

const emptyInput = (kind: ExperienceKind): ExperienceInput => ({
  kind,
  title: "",
  tagline: "",
  description: "",
  category: "",
  host_title: "",
  city: "",
  state: "",
  country: "India",
  meeting_point: "",
  address: "",
  latitude: 28.6139,
  longitude: 77.209,
  price_per_guest: kind === "experience" ? 2500 : 4000,
  duration_minutes: kind === "experience" ? 120 : 60,
  max_guests: kind === "experience" ? 8 : 2,
  language: "English",
  included: "",
  private_groups: false,
  photo_urls: [],
  activities: [{ title: "", description: "", photo_url: null }],
  start_times: ["10:00"],
  schedule_days: 28,
});

/** Create/edit form for both kinds; copy and defaults switch on `kind`. */
export default function ExperienceForm({ kind, initial, experienceId }: { kind: ExperienceKind; initial?: ExperienceInput; experienceId?: number }) {
  const router = useRouter();
  const { toast } = useApp();
  const [form, setForm] = useState<ExperienceInput>(initial ?? emptyInput(kind));
  const [categories, setCategories] = useState<Category[]>([]);
  const [photoUrl, setPhotoUrl] = useState("");
  const [newTime, setNewTime] = useState("18:00");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isService = kind === "service";
  const noun = isService ? "service" : "experience";

  useEffect(() => {
    api.experienceCategories(kind, true).then(setCategories).catch(() => {});
  }, [kind]);

  const set = <K extends keyof ExperienceInput>(key: K, value: ExperienceInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setActivity = (i: number, patch: Partial<ExperienceInput["activities"][number]>) =>
    set("activities", form.activities.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  function validate() {
    const e: Record<string, string> = {};
    if (!form.category) e.category = "Pick a category";
    if (form.title.trim().length < 5) e.title = "Title must be at least 5 characters";
    if (form.tagline.trim().length < 10) e.tagline = "Tagline must be at least 10 characters";
    if (form.description.trim().length < 20) e.description = "Description must be at least 20 characters";
    if (form.host_title.trim().length < 2) e.host_title = "Tell guests your role, e.g. “Photographer”";
    if (!form.city.trim()) e.city = "City is required";
    if (!form.country.trim()) e.country = "Country is required";
    if (form.meeting_point.trim().length < 2) e.meeting_point = isService ? "Say where you'll provide it" : "Where should guests meet you?";
    if (form.address.trim().length < 2) e.address = "Address is required";
    if (form.included.trim().length < 2) e.included = "List what's included";
    if (!Number.isInteger(form.price_per_guest) || form.price_per_guest <= 0 || form.price_per_guest > 1_000_000)
      e.price_per_guest = "Enter a whole number between ₹1 and ₹10,00,000";
    if (form.language.trim().length < 2) e.language = "Which language do you host in?";
    if (!Number.isFinite(form.latitude) || Math.abs(form.latitude) > 90) e.latitude = "Latitude must be between -90 and 90";
    if (!Number.isFinite(form.longitude) || Math.abs(form.longitude) > 180) e.longitude = "Longitude must be between -180 and 180";
    if (form.photo_urls.length === 0) e.photos = "Add at least one photo";
    if (form.photo_urls.length > MAX_PHOTOS) e.photos = `Use at most ${MAX_PHOTOS} photos`;
    if (form.activities.some((a) => a.title.trim().length < 2 || a.description.trim().length < 2))
      e.activities = "Give every step a title and a short description";
    if (form.start_times.length === 0) e.start_times = "Add at least one start time";
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
      const payload: ExperienceInput = {
        ...form,
        state: form.state || null,
        activities: form.activities.map((a) => ({ ...a, photo_url: a.photo_url?.trim() || null })),
      };
      const saved = experienceId ? await api.updateExperience(experienceId, payload) : await api.createExperience(payload);
      toast(experienceId ? `${isService ? "Service" : "Experience"} updated` : `Your ${noun} is live!`, "success", saved.photos[0]);
      router.push(experienceHref(saved));
    } catch (e) {
      toast(e instanceof Error ? e.message : `Couldn't save ${noun}`, "error");
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

  function addTime() {
    if (!/^\d{2}:\d{2}$/.test(newTime) || form.start_times.includes(newTime)) return;
    if (form.start_times.length >= MAX_START_TIMES) {
      toast(`Up to ${MAX_START_TIMES} start times a day`, "error");
      return;
    }
    set("start_times", [...form.start_times, newTime].sort());
  }

  const input = "w-full rounded-lg border border-gray-400 px-4 py-3 outline-none focus:border-ink focus:ring-1 focus:ring-ink";
  const label = "mb-1.5 block text-sm font-semibold";
  const err = (k: string) => errors[k] && <p className="mt-1 text-sm text-brand">{errors[k]}</p>;
  const chip = (on: boolean) => `rounded-xl border px-4 py-2.5 text-sm font-semibold ${on ? "border-2 border-ink bg-soft" : "border-line hover:border-ink"}`;

  return (
    <form onSubmit={submit} className="space-y-12">
      <section>
        <h2 className="text-[22px] font-semibold">What kind of {noun} is it?</h2>
        <div className="mt-5 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button type="button" key={c.name} onClick={() => set("category", c.name)} className={chip(form.category === c.name)}>
              {c.name}
            </button>
          ))}
        </div>
        {err("category")}
      </section>

      <section className="space-y-5">
        <h2 className="text-[22px] font-semibold">Title and description</h2>
        <div>
          <label className={label}>Title</label>
          <input className={input} value={form.title} maxLength={200} onChange={(e) => set("title", e.target.value)}
            placeholder={isService ? "Professional vacation photography" : "Chai workshop in a local family home"} />
          {err("title")}
        </div>
        <div>
          <label className={label}>Tagline</label>
          <input className={input} value={form.tagline} maxLength={300} onChange={(e) => set("tagline", e.target.value)}
            placeholder="One sentence shown under the title" />
          {err("tagline")}
        </div>
        <div>
          <label className={label}>Description</label>
          <textarea className={input} rows={6} value={form.description} onChange={(e) => set("description", e.target.value)}
            placeholder={`Tell guests what makes your ${noun} special`} />
          {err("description")}
        </div>
        <div className="max-w-sm">
          <label className={label}>Your role</label>
          <input className={input} value={form.host_title} maxLength={100} onChange={(e) => set("host_title", e.target.value)}
            placeholder={isService ? "Photographer" : "Cooking instructor"} />
          <p className="mt-1 text-xs text-muted">Shown as “Hosted by you · {form.host_title || "Your role"}”</p>
          {err("host_title")}
        </div>
      </section>

      <section>
        <h2 className="text-[22px] font-semibold">{isService ? "What's offered" : "What you'll do"}</h2>
        <p className="mt-1 text-sm text-muted">
          {isService ? "List the packages or options guests can choose from." : "Walk guests through the plan, step by step."}
        </p>
        <div className="mt-5 space-y-4">
          {form.activities.map((a, i) => (
            <div key={i} className="rounded-xl border border-line p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-muted">{isService ? `Option ${i + 1}` : `Step ${i + 1}`}</p>
                {form.activities.length > 1 && (
                  <button type="button" aria-label="Remove" onClick={() => set("activities", form.activities.filter((_, j) => j !== i))}
                    className="rounded-full p-1.5 hover:bg-soft">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr]">
                <input className={input} value={a.title} maxLength={200} placeholder="Title" onChange={(e) => setActivity(i, { title: e.target.value })} />
                <input className={input} value={a.photo_url ?? ""} placeholder="Photo URL (optional)" onChange={(e) => setActivity(i, { photo_url: e.target.value })} />
                <textarea className={`${input} sm:col-span-2`} rows={2} value={a.description} maxLength={1000} placeholder="A sentence or two"
                  onChange={(e) => setActivity(i, { description: e.target.value })} />
              </div>
            </div>
          ))}
        </div>
        {form.activities.length < 10 && (
          <button type="button" onClick={() => set("activities", [...form.activities, { title: "", description: "", photo_url: null }])}
            className="mt-4 flex items-center gap-2 text-sm font-semibold underline">
            <Plus className="h-4 w-4" /> Add {isService ? "an option" : "a step"}
          </button>
        )}
        {err("activities")}
      </section>

      <section>
        <h2 className="text-[22px] font-semibold">{isService ? "Where do you provide it?" : "Where will you meet?"}</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label className={label}>{isService ? "Service area" : "Meeting point"}</label>
            <input className={input} value={form.meeting_point} maxLength={200} onChange={(e) => set("meeting_point", e.target.value)}
              placeholder={isService ? "Your stay in Delhi" : "Greater Kailash-1"} />
            {err("meeting_point")}
          </div>
          <div className="sm:col-span-3">
            <label className={label}>Address</label>
            <input className={input} value={form.address} maxLength={300} onChange={(e) => set("address", e.target.value)} placeholder="New Delhi, Delhi, 110048" />
            {err("address")}
          </div>
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
        <h2 className="text-[22px] font-semibold">Details</h2>
        <div className="mt-4 max-w-xl divide-y divide-line">
          <div className="flex items-center justify-between gap-4 py-4">
            <span>Duration</span>
            <select className="rounded-lg border border-gray-400 px-3 py-2" value={form.duration_minutes} onChange={(e) => set("duration_minutes", Number(e.target.value))}>
              {[...new Set([...DURATIONS, form.duration_minutes])].sort((a, b) => a - b).map((m) => (
                <option key={m} value={m}>{formatDuration(m)}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between py-4">
            <span>Maximum guests per time slot</span>
            <Counter value={form.max_guests} onChange={(v) => set("max_guests", v)} min={1} max={50} />
          </div>
          <div className="flex items-center justify-between gap-4 py-4">
            <span>Language</span>
            <input className="w-44 rounded-lg border border-gray-400 px-3 py-2" value={form.language} maxLength={50} onChange={(e) => set("language", e.target.value)} />
          </div>
          {err("language")}
          <label className="flex cursor-pointer items-center justify-between py-4">
            <span>
              Private groups available
              <span className="block text-sm text-muted">Guests can book the whole slot for their own group</span>
            </span>
            <input type="checkbox" className="h-5 w-5 accent-ink" checked={form.private_groups} onChange={(e) => set("private_groups", e.target.checked)} />
          </label>
        </div>
        <div className="mt-4 max-w-xl">
          <label className={label}>What&apos;s included</label>
          <input className={input} value={form.included} maxLength={300} onChange={(e) => set("included", e.target.value)}
            placeholder={isService ? "40 edited photos within 48 hours" : "Light bites and speciality drinks"} />
          {err("included")}
        </div>
      </section>

      <section>
        <h2 className="text-[22px] font-semibold">When can guests book?</h2>
        <p className="mt-1 text-sm text-muted">
          Add the daily start times. Each one becomes a bookable time slot for the next {form.schedule_days} days. Removing a time later
          keeps any slots that already have bookings.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {form.start_times.map((t) => (
            <span key={t} className="flex items-center gap-1 rounded-full border border-ink py-1.5 pl-4 pr-1.5 text-sm font-semibold">
              {formatTime(`2000-01-01T${t}:00`)}
              <button type="button" aria-label={`Remove ${t}`} onClick={() => set("start_times", form.start_times.filter((x) => x !== t))}
                className="rounded-full p-1 hover:bg-soft">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
          <span className="flex items-center gap-2">
            <input type="time" step={900} value={newTime} onChange={(e) => setNewTime(e.target.value)} className="rounded-lg border border-gray-400 px-3 py-1.5" />
            <button type="button" onClick={addTime} className="rounded-lg border border-ink px-3 py-1.5 text-sm font-semibold hover:bg-soft">Add time</button>
          </span>
        </div>
        {err("start_times")}
        <div className="mt-5 flex items-center gap-3">
          <span className="text-sm">Schedule ahead</span>
          <select className="rounded-lg border border-gray-400 px-3 py-2 text-sm" value={form.schedule_days} onChange={(e) => set("schedule_days", Number(e.target.value))}>
            {[7, 14, 28, 60, 90].map((d) => (
              <option key={d} value={d}>{d} days</option>
            ))}
          </select>
        </div>
      </section>

      <section>
        <h2 className="text-[22px] font-semibold">Add some photos</h2>
        <p className="mt-1 text-sm text-muted">Paste image URLs or upload files. The first four make up the photo collage.</p>
        <div className="mt-5 flex gap-2">
          <input className={input} value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://images.unsplash.com/…"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addUrl();
              }
            }} />
          <button type="button" onClick={addUrl} className="shrink-0 rounded-lg border border-ink px-5 font-semibold hover:bg-soft">Add</button>
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
                <button type="button" aria-label="Remove photo" onClick={() => set("photo_urls", form.photo_urls.filter((_, j) => j !== i))}
                  className="absolute right-2 top-2 rounded-full bg-white p-1 shadow">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[22px] font-semibold">Now, set your price</h2>
        <div className="mt-5 max-w-xs">
          <label className={label}>Price per guest (₹)</label>
          <input className={input} type="number" min={1} step={1} value={form.price_per_guest} onChange={(e) => set("price_per_guest", Number(e.target.value))} />
          {err("price_per_guest")}
        </div>
      </section>

      <div className="sticky bottom-0 -mx-6 flex justify-between border-t border-line bg-white px-6 py-4">
        <button type="button" onClick={() => router.back()} className="font-semibold underline">Cancel</button>
        <BrandButton type="submit" disabled={saving || uploading}>
          {saving ? "Saving…" : experienceId ? "Save changes" : `Publish ${noun}`}
        </BrandButton>
      </div>
    </form>
  );
}
