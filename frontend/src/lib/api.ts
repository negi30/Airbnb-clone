import type {
  Amenity,
  Booking,
  Category,
  HostListing,
  ListingDetail,
  ListingInput,
  ListingPage,
  PriceStats,
  Quote,
  Review,
  User,
  ListingCard,
  ExperienceBooking,
  ExperienceCard,
  ExperienceDetail,
  ExperienceKind,
  ExperiencePage,
  ExperienceInput,
  ExperienceQuote,
  HostExperience,
  Slot,
  ConversationDetail,
  ConversationSummary,
  ListingType,
  Message,
} from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

const USER_KEY = "airbnb-clone:user-id";

/** Fired after the inbox marks messages read, so the header's unread badge refreshes. */
export const MESSAGES_READ_EVENT = "airbnb-clone:messages-read";

/** Mocked auth: the active account id lives in localStorage and is sent as X-User-Id. */
export function getStoredUserId(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(USER_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function setStoredUserId(id: number) {
  try {
    window.localStorage.setItem(USER_KEY, String(id));
  } catch {
    /* private mode: fall back to in-memory default */
  }
}

export class ApiError extends Error {
  /** Machine-readable reason when the API sends one, e.g. "CONTACT_INFO_PROHIBITED". */
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const uid = getStoredUserId();
  if (uid) headers.set("X-User-Id", String(uid));
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");

  const res = await fetch(`${API_URL}${path}`, { ...init, headers, cache: "no-store" });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = await res.json();
      if (typeof body.code === "string") code = body.code;
      if (typeof body.message === "string") message = body.message;
      else if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail) && body.detail[0]?.msg)
        message = String(body.detail[0].msg).replace(/^Value error, /, "");
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, code);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "" && v !== false) sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : "";
};

export const api = {
  // users
  users: () => request<User[]>("/api/users"),

  // metadata
  amenities: () => request<Amenity[]>("/api/amenities"),
  categories: () => request<Category[]>("/api/categories"),
  propertyTypes: () => request<string[]>("/api/property-types"),
  priceStats: () => request<PriceStats>("/api/listings/price-stats"),

  // listings
  searchListings: (params: Record<string, string | number | boolean | undefined>) =>
    request<ListingPage>(`/api/listings${qs(params)}`),
  listing: (id: number) => request<ListingDetail>(`/api/listings/${id}`),
  quote: (id: number, check_in: string, check_out: string, guests: number) =>
    request<Quote>(`/api/listings/${id}/quote${qs({ check_in, check_out, guests })}`),
  reviews: (id: number) => request<Review[]>(`/api/listings/${id}/reviews`),
  createReview: (listingId: number, body: { booking_id: number; rating: number; comment: string }) =>
    request<Review>(`/api/listings/${listingId}/reviews`, { method: "POST", body: JSON.stringify(body) }),

  // host
  createListing: (body: ListingInput) =>
    request<ListingDetail>("/api/listings", { method: "POST", body: JSON.stringify(body) }),
  updateListing: (id: number, body: ListingInput) =>
    request<ListingDetail>(`/api/listings/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteListing: (id: number) => request<void>(`/api/listings/${id}`, { method: "DELETE" }),
  hostListings: () => request<HostListing[]>("/api/host/listings"),
  hostBookings: () => request<Booking[]>("/api/host/bookings"),
  hostExperiences: (kind?: ExperienceKind) => request<HostExperience[]>(`/api/host/experiences${qs({ kind })}`),
  hostExperienceForm: (id: number) => request<ExperienceInput & { id: number }>(`/api/host/experiences/${id}`),
  hostExperienceBookings: () => request<ExperienceBooking[]>("/api/host/experience-bookings"),
  createExperience: (body: ExperienceInput) =>
    request<ExperienceDetail>("/api/experiences", { method: "POST", body: JSON.stringify(body) }),
  updateExperience: (id: number, body: ExperienceInput) =>
    request<ExperienceDetail>(`/api/experiences/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteExperience: (id: number) => request<void>(`/api/experiences/${id}`, { method: "DELETE" }),
  /** Host-initiated cancellation: recorded as cancelled_by="host" so the guest sees why on /trips. */
  hostCancelReservation: (kind: "home" | ExperienceKind, id: number) =>
    request<Booking | ExperienceBooking>(`/api/host/reservations/${kind}/${id}/cancel`, { method: "PATCH" }),
  uploadImage: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ url: string }>("/api/uploads", { method: "POST", body: fd });
  },

  // bookings
  createBooking: (body: { listing_id: number; check_in: string; check_out: string; guests: number }) =>
    request<Booking>("/api/bookings", { method: "POST", body: JSON.stringify(body) }),
  myTrips: () => request<Booking[]>("/api/bookings/me"),
  cancelBooking: (id: number) => request<Booking>(`/api/bookings/${id}/cancel`, { method: "POST" }),

  // wishlists
  wishlist: () => request<ListingCard[]>("/api/wishlists"),
  wishlistIds: () => request<number[]>("/api/wishlists/ids"),
  addToWishlist: (id: number) => request<void>(`/api/wishlists/${id}`, { method: "PUT" }),
  removeFromWishlist: (id: number) => request<void>(`/api/wishlists/${id}`, { method: "DELETE" }),

  // experiences & services
  searchExperiences: (params: Record<string, string | number | boolean | undefined>) =>
    request<ExperiencePage>(`/api/experiences${qs(params)}`),
  experienceCategories: (kind: ExperienceKind, all = false) =>
    request<Category[]>(`/api/experiences/categories${qs({ kind, all })}`),
  experience: (id: number) => request<ExperienceDetail>(`/api/experiences/${id}`),
  experienceSlots: (id: number, guests = 1, days = 30) =>
    request<Slot[]>(`/api/experiences/${id}/slots${qs({ guests, days })}`),
  experienceQuote: (id: number, guests: number) =>
    request<ExperienceQuote>(`/api/experiences/${id}/quote${qs({ guests })}`),
  experienceReviews: (id: number) => request<Review[]>(`/api/experiences/${id}/reviews`),
  createExperienceReview: (id: number, body: { booking_id: number; rating: number; comment: string }) =>
    request<Review>(`/api/experiences/${id}/reviews`, { method: "POST", body: JSON.stringify(body) }),
  bookExperience: (body: { slot_id: number; guests: number }) =>
    request<ExperienceBooking>("/api/experience-bookings", { method: "POST", body: JSON.stringify(body) }),
  myExperienceBookings: () => request<ExperienceBooking[]>("/api/experience-bookings/me"),
  cancelExperienceBooking: (id: number) =>
    request<ExperienceBooking>(`/api/experience-bookings/${id}/cancel`, { method: "POST" }),
  savedExperiences: () => request<ExperienceCard[]>("/api/experiences/saved"),
  savedExperienceIds: () => request<number[]>("/api/experiences/saved/ids"),
  saveExperience: (id: number) => request<void>(`/api/experiences/${id}/save`, { method: "PUT" }),
  unsaveExperience: (id: number) => request<void>(`/api/experiences/${id}/save`, { method: "DELETE" }),

  // messaging
  conversations: (role?: "guest" | "host") => request<ConversationSummary[]>(`/api/conversations${qs({ role })}`),
  conversation: (id: number) => request<ConversationDetail>(`/api/conversations/${id}`),
  /** Get-or-create the thread for a listing; pass reservation_id when opening it from a trip or reservation. */
  startConversation: (body: { listing_type: ListingType; listing_id?: number; reservation_id?: number }) =>
    request<ConversationDetail>("/api/conversations", { method: "POST", body: JSON.stringify(body) }),
  sendMessage: (id: number, content: string) =>
    request<Message>(`/api/conversations/${id}/messages`, { method: "POST", body: JSON.stringify({ content }) }),
  markConversationRead: (id: number) => request<void>(`/api/conversations/${id}/read`, { method: "POST" }),
  unreadCount: () => request<{ count: number }>("/api/conversations/unread-count"),
};
