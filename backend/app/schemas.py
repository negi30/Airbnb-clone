"""Pydantic request/response models — the API contract."""
import re
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

from .services.availability import stay_dates_error


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- users ----------
class UserOut(ORM):
    id: int
    name: str
    email: str
    avatar_url: str | None
    is_host: bool
    is_superhost: bool


class HostOut(ORM):
    id: int
    name: str
    avatar_url: str | None
    bio: str | None
    is_superhost: bool
    created_at: datetime
    listing_count: int = 0
    review_count: int = 0
    rating: float | None = None


# ---------- amenities ----------
class AmenityOut(ORM):
    id: int
    name: str
    icon: str


# ---------- listings ----------
class ListingCard(BaseModel):
    """Compact shape used by the explore grid, wishlists and trips."""

    id: int
    title: str
    city: str
    state: str | None
    country: str
    property_type: str
    category: str
    price_per_night: int
    rating: float | None
    review_count: int
    photos: list[str]
    latitude: float
    longitude: float
    bedrooms: int
    beds: int
    max_guests: int
    host_name: str
    host_is_superhost: bool


class DateRange(BaseModel):
    check_in: date
    check_out: date


class ListingDetail(ListingCard):
    description: str
    cleaning_fee: int
    bathrooms: int
    amenities: list[AmenityOut]
    host: HostOut
    booked_ranges: list[DateRange]
    created_at: datetime


class ListingPage(BaseModel):
    items: list[ListingCard]
    total: int
    page: int
    page_size: int
    has_more: bool


class ListingIn(BaseModel):
    """Create/update payload sent by the host form."""

    model_config = ConfigDict(str_strip_whitespace=True)  # "     " must not pass min_length

    title: str = Field(min_length=5, max_length=200)
    description: str = Field(min_length=20)
    property_type: str
    category: str
    city: str = Field(min_length=1)
    state: str | None = None
    country: str = Field(min_length=1)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    price_per_night: int = Field(gt=0, le=1_000_000)
    cleaning_fee: int = Field(ge=0, default=0)
    max_guests: int = Field(gt=0, le=50)
    bedrooms: int = Field(ge=0, le=50)
    beds: int = Field(ge=1, le=100)
    bathrooms: int = Field(ge=1, le=50)
    amenity_ids: list[int] = []
    photo_urls: list[str] = Field(min_length=1, max_length=20)

    @field_validator("photo_urls")
    @classmethod
    def _valid_urls(cls, urls: list[str]) -> list[str]:
        cleaned = [u.strip() for u in urls if u.strip()]
        for u in cleaned:
            if not (u.startswith("/") or u.startswith("http")):
                HttpUrl(u)  # raises a readable validation error
        if not cleaned:
            raise ValueError("At least one photo is required")
        return cleaned


class HostListingOut(ListingCard):
    upcoming_bookings: int
    total_earnings: int


# ---------- pricing ----------
class Quote(BaseModel):
    available: bool
    nightly_rate: int
    nights: int
    subtotal: int
    cleaning_fee: int
    service_fee: int
    taxes: int
    total: int


# ---------- bookings ----------
class BookingIn(BaseModel):
    listing_id: int
    check_in: date
    check_out: date
    guests: int = Field(gt=0)

    @model_validator(mode="after")
    def _dates_in_order(self):
        if error := stay_dates_error(self.check_in, self.check_out):
            raise ValueError(error)
        return self


class BookingOut(BaseModel):
    id: int
    listing: ListingCard
    guest: UserOut
    check_in: date
    check_out: date
    guests: int
    nightly_rate: int
    nights: int
    cleaning_fee: int
    service_fee: int
    taxes: int
    total_price: int
    status: str
    cancelled_by: str | None  # "guest" | "host" once cancelled
    cancelled_at: datetime | None
    created_at: datetime
    has_review: bool


# ---------- reviews ----------
class ReviewOut(ORM):
    id: int
    rating: int
    comment: str
    created_at: datetime
    author: UserOut


class ReviewIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    booking_id: int
    rating: int = Field(ge=1, le=5)
    comment: str = Field(min_length=5, max_length=2000)


# ---------- experiences & services ----------
class ExperienceCard(BaseModel):
    """Compact shape for the experiences/services rows and grids."""

    id: int
    kind: str
    title: str
    category: str
    city: str
    country: str
    price_per_guest: int
    duration_minutes: int
    rating: float | None
    review_count: int
    photos: list[str]
    host_name: str
    next_slot: datetime | None  # first bookable slot (inside the requested window, if any)


class ExperiencePage(BaseModel):
    items: list[ExperienceCard]
    total: int
    page: int
    page_size: int
    has_more: bool


class ActivityOut(ORM):
    id: int
    title: str
    description: str
    photo_url: str | None


class ExperienceDetail(ExperienceCard):
    tagline: str
    description: str
    host_title: str
    state: str | None
    meeting_point: str
    address: str
    latitude: float
    longitude: float
    max_guests: int
    language: str
    included: str
    free_cancellation: bool
    private_groups: bool
    activities: list[ActivityOut]
    host: HostOut


class SlotOut(BaseModel):
    id: int
    starts_at: datetime
    ends_at: datetime
    capacity: int
    spots_left: int


class ExperienceQuote(BaseModel):
    price_per_guest: int
    guests: int
    subtotal: int
    service_fee: int
    taxes: int
    total: int


class ExperienceBookingIn(BaseModel):
    slot_id: int
    guests: int = Field(gt=0, le=50)


class ExperienceBookingOut(BaseModel):
    id: int
    experience: ExperienceCard
    guest: UserOut
    slot: SlotOut
    guests: int
    price_per_guest: int
    subtotal: int
    service_fee: int
    taxes: int
    total_price: int
    status: str
    cancelled_by: str | None
    cancelled_at: datetime | None
    created_at: datetime
    has_review: bool


# ---------- host: experiences & services ----------
class HostExperienceOut(ExperienceCard):
    max_guests: int
    upcoming_bookings: int  # confirmed bookings on slots that haven't started
    upcoming_slots: int  # scheduled future slots
    total_earnings: int  # host payout: subtotal of confirmed bookings


class ActivityIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(min_length=2, max_length=200)
    description: str = Field(min_length=2, max_length=1000)
    photo_url: str | None = None


TIME_PATTERN = r"^([01]\d|2[0-3]):[0-5]\d$"


class ExperienceIn(BaseModel):
    """Create/update payload for the host's experience/service form."""

    model_config = ConfigDict(str_strip_whitespace=True)

    kind: str = Field(pattern="^(experience|service)$")
    title: str = Field(min_length=5, max_length=200)
    tagline: str = Field(min_length=10, max_length=300)
    description: str = Field(min_length=20)
    category: str
    host_title: str = Field(min_length=2, max_length=100)
    city: str = Field(min_length=1)
    state: str | None = None
    country: str = Field(min_length=1)
    meeting_point: str = Field(min_length=2, max_length=200)
    address: str = Field(min_length=2, max_length=300)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    price_per_guest: int = Field(gt=0, le=1_000_000)
    duration_minutes: int = Field(ge=15, le=24 * 60)
    max_guests: int = Field(gt=0, le=50)
    language: str = Field("English", min_length=2, max_length=50)
    included: str = Field(min_length=2, max_length=300)
    private_groups: bool = False
    photo_urls: list[str] = Field(min_length=1, max_length=20)
    activities: list[ActivityIn] = Field(min_length=1, max_length=10)
    # Daily start times ("09:00"); the next `schedule_days` days get one slot per time.
    start_times: list[str] = Field(min_length=1, max_length=8)
    schedule_days: int = Field(28, ge=1, le=90)

    @field_validator("photo_urls")
    @classmethod
    def _valid_urls(cls, urls: list[str]) -> list[str]:
        cleaned = [u.strip() for u in urls if u.strip()]
        if not cleaned:
            raise ValueError("At least one photo is required")
        for u in cleaned:
            if not (u.startswith("/") or u.startswith("http")):
                HttpUrl(u)
        return cleaned

    @field_validator("start_times")
    @classmethod
    def _valid_times(cls, times: list[str]) -> list[str]:
        for t in times:
            if not re.match(TIME_PATTERN, t):
                raise ValueError(f"Start times must look like 09:30 (got {t!r})")
        return sorted(set(times))


class HostExperienceForm(ExperienceIn):
    """What the edit form is prefilled with."""

    id: int


# ---------- messaging ----------
ListingType = Literal["home", "experience", "service"]
ReservationStatus = Literal["inquiry", "upcoming", "in_progress", "completed", "cancelled_by_host", "cancelled_by_guest"]


class Participant(ORM):
    id: int
    name: str
    avatar_url: str | None


class ConversationListing(BaseModel):
    type: ListingType
    id: int
    title: str
    photo: str | None
    city: str
    country: str


class ConversationReservation(BaseModel):
    id: int
    status: ReservationStatus
    guests: int
    total_price: int
    check_in: date | None = None  # homes
    check_out: date | None = None
    starts_at: datetime | None = None  # experiences & services
    ends_at: datetime | None = None


class MessageOut(ORM):
    id: int
    sender_id: int
    sender_role: Literal["guest", "host"]
    content: str
    is_blocked: bool
    raw_attempted_flag: bool
    moderation_warning: str | None
    created_at: datetime
    read_at: datetime | None


class ConversationSummary(BaseModel):
    id: int
    role: Literal["guest", "host"]  # the viewer's side of this thread
    counterpart: Participant
    listing: ConversationListing | None  # None once the listing has been deleted
    status: ReservationStatus
    last_message: MessageOut | None
    unread_count: int
    updated_at: datetime


class ConversationDetail(ConversationSummary):
    reservation: ConversationReservation | None
    messages: list[MessageOut]


class ConversationIn(BaseModel):
    """Start (or reopen) a thread. With `reservation_id` either side may start it and
    `listing_id` is taken from the reservation; without one it's a guest's inquiry."""

    listing_type: ListingType
    listing_id: int | None = None
    reservation_id: int | None = None

    @model_validator(mode="after")
    def _target(self):
        if self.listing_id is None and self.reservation_id is None:
            raise ValueError("Pass a listing_id or a reservation_id")
        return self


class MessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=1000)

    @field_validator("content")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Message can't be empty")
        return v


class UnreadCount(BaseModel):
    count: int
