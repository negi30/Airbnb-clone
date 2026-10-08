// Mirrors backend/app/schemas.py

export interface User {
  id: number;
  name: string;
  email: string;
  avatar_url: string | null;
  is_host: boolean;
  is_superhost: boolean;
}

export interface Host {
  id: number;
  name: string;
  avatar_url: string | null;
  bio: string | null;
  is_superhost: boolean;
  created_at: string;
  listing_count: number;
  review_count: number;
  rating: number | null;
}

export interface Amenity {
  id: number;
  name: string;
  icon: string;
}

export interface ListingCard {
  id: number;
  title: string;
  city: string;
  state: string | null;
  country: string;
  property_type: string;
  category: string;
  price_per_night: number;
  rating: number | null;
  review_count: number;
  photos: string[];
  latitude: number;
  longitude: number;
  bedrooms: number;
  beds: number;
  max_guests: number;
  host_name: string;
  host_is_superhost: boolean;
}

export interface DateRange {
  check_in: string; // YYYY-MM-DD
  check_out: string; // exclusive
}

export interface ListingDetail extends ListingCard {
  description: string;
  cleaning_fee: number;
  bathrooms: number;
  amenities: Amenity[];
  host: Host;
  booked_ranges: DateRange[];
  created_at: string;
}

export interface ListingPage {
  items: ListingCard[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface HostListing extends ListingCard {
  upcoming_bookings: number;
  total_earnings: number;
}

export interface Quote {
  available: boolean;
  nightly_rate: number;
  nights: number;
  subtotal: number;
  cleaning_fee: number;
  service_fee: number;
  taxes: number;
  total: number;
}

export interface Booking {
  id: number;
  listing: ListingCard;
  guest: User;
  check_in: string;
  check_out: string;
  guests: number;
  nightly_rate: number;
  nights: number;
  cleaning_fee: number;
  service_fee: number;
  taxes: number;
  total_price: number;
  status: "confirmed" | "cancelled";
  cancelled_by: CancelledBy | null;
  cancelled_at: string | null;
  created_at: string;
  has_review: boolean;
}

export type CancelledBy = "guest" | "host";

export interface Review {
  id: number;
  rating: number;
  comment: string;
  created_at: string;
  author: User;
}

export interface Category {
  name: string;
  count: number;
}

export interface PriceStats {
  min: number;
  max: number;
  histogram: number[];
}

export interface ListingInput {
  title: string;
  description: string;
  property_type: string;
  category: string;
  city: string;
  state: string | null;
  country: string;
  latitude: number;
  longitude: number;
  price_per_night: number;
  cleaning_fee: number;
  max_guests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  amenity_ids: number[];
  photo_urls: string[];
}

// ---------- experiences & services ----------
export type ExperienceKind = "experience" | "service";

export interface ExperienceCard {
  id: number;
  kind: ExperienceKind;
  title: string;
  category: string;
  city: string;
  country: string;
  price_per_guest: number;
  duration_minutes: number;
  rating: number | null;
  review_count: number;
  photos: string[];
  host_name: string;
  next_slot: string | null; // local ISO datetime, e.g. "2026-10-08T18:00:00"
}

export interface ExperiencePage {
  items: ExperienceCard[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface Activity {
  id: number;
  title: string;
  description: string;
  photo_url: string | null;
}

export interface ExperienceDetail extends ExperienceCard {
  tagline: string;
  description: string;
  host_title: string;
  state: string | null;
  meeting_point: string;
  address: string;
  latitude: number;
  longitude: number;
  max_guests: number;
  language: string;
  included: string;
  free_cancellation: boolean;
  private_groups: boolean;
  activities: Activity[];
  host: Host;
}

export interface Slot {
  id: number;
  starts_at: string;
  ends_at: string;
  capacity: number;
  spots_left: number;
}

export interface ExperienceQuote {
  price_per_guest: number;
  guests: number;
  subtotal: number;
  service_fee: number;
  taxes: number;
  total: number;
}

export interface ExperienceBooking {
  id: number;
  experience: ExperienceCard;
  guest: User;
  slot: Slot;
  guests: number;
  price_per_guest: number;
  subtotal: number;
  service_fee: number;
  taxes: number;
  total_price: number;
  status: "confirmed" | "cancelled";
  cancelled_by: CancelledBy | null;
  cancelled_at: string | null;
  created_at: string;
  has_review: boolean;
}

export interface HostExperience extends ExperienceCard {
  max_guests: number;
  upcoming_bookings: number;
  upcoming_slots: number;
  total_earnings: number;
}

export interface ActivityInput {
  title: string;
  description: string;
  photo_url: string | null;
}

export interface ExperienceInput {
  kind: ExperienceKind;
  title: string;
  tagline: string;
  description: string;
  category: string;
  host_title: string;
  city: string;
  state: string | null;
  country: string;
  meeting_point: string;
  address: string;
  latitude: number;
  longitude: number;
  price_per_guest: number;
  duration_minutes: number;
  max_guests: number;
  language: string;
  included: string;
  private_groups: boolean;
  photo_urls: string[];
  activities: ActivityInput[];
  start_times: string[]; // "09:00"
  schedule_days: number;
}

// ---------- messaging ----------
export type ListingType = "home" | ExperienceKind;
export type ThreadStatus = "inquiry" | "upcoming" | "in_progress" | "completed" | "cancelled_by_host" | "cancelled_by_guest";

export interface Participant {
  id: number;
  name: string;
  avatar_url: string | null;
}

export interface ConversationListing {
  type: ListingType;
  id: number;
  title: string;
  photo: string | null;
  city: string;
  country: string;
}

export interface ConversationReservation {
  id: number;
  status: ThreadStatus;
  guests: number;
  total_price: number;
  check_in: string | null;
  check_out: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

export interface Message {
  id: number;
  sender_id: number;
  sender_role: "guest" | "host";
  content: string;
  is_blocked: boolean;
  raw_attempted_flag: boolean;
  moderation_warning: string | null;
  created_at: string;
  read_at: string | null;
}

export interface ConversationSummary {
  id: number;
  role: "guest" | "host";
  counterpart: Participant;
  listing: ConversationListing | null;
  status: ThreadStatus;
  last_message: Message | null;
  unread_count: number;
  updated_at: string;
}

export interface ConversationDetail extends ConversationSummary {
  reservation: ConversationReservation | null;
  messages: Message[];
}
