"""ORM models — the database schema.

users ─┬─< listings ─┬─< listing_photos
       │             ├─< listing_amenities >── amenities
       │             ├─< bookings >── users (guest)
       │             ├─< reviews  >── users (author)
       ├─< wishlist_items >── listings
       ├─< conversations (as guest / as host) ─< messages
       └─< experiences ─┬─< experience_photos
                        ├─< experience_activities
                        ├─< experience_slots ─< experience_bookings >── users (guest)
                        ├─< experience_reviews >── users (author)
                        └─< saved_experiences >── users

An "experience" row is either a guided experience or a bookable service (`kind`).
"""
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

# Many-to-many join table between listings and amenities
listing_amenities = Table(
    "listing_amenities",
    Base.metadata,
    Column("listing_id", ForeignKey("listings.id", ondelete="CASCADE"), primary_key=True),
    Column("amenity_id", ForeignKey("amenities.id", ondelete="CASCADE"), primary_key=True),
)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(255), unique=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    bio: Mapped[str | None] = mapped_column(Text)
    is_host: Mapped[bool] = mapped_column(Boolean, default=False)
    is_superhost: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    listings: Mapped[list["Listing"]] = relationship(back_populates="host")
    bookings: Mapped[list["Booking"]] = relationship(back_populates="guest")


class Listing(Base):
    __tablename__ = "listings"
    __table_args__ = (
        CheckConstraint("price_per_night > 0", name="ck_listing_price_positive"),
        CheckConstraint("max_guests > 0", name="ck_listing_guests_positive"),
        Index("ix_listings_city", "city"),
        Index("ix_listings_category", "category"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    host_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    property_type: Mapped[str] = mapped_column(String(50))  # Apartment, House, Villa, Cabin...
    category: Mapped[str] = mapped_column(String(50))  # Beachfront, Cabins, Amazing views...
    city: Mapped[str] = mapped_column(String(100))
    state: Mapped[str | None] = mapped_column(String(100))
    country: Mapped[str] = mapped_column(String(100))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    price_per_night: Mapped[int] = mapped_column(Integer)  # whole rupees
    cleaning_fee: Mapped[int] = mapped_column(Integer, default=0)
    max_guests: Mapped[int] = mapped_column(Integer)
    bedrooms: Mapped[int] = mapped_column(Integer, default=1)
    beds: Mapped[int] = mapped_column(Integer, default=1)
    bathrooms: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    host: Mapped[User] = relationship(back_populates="listings")
    photos: Mapped[list["ListingPhoto"]] = relationship(
        back_populates="listing",
        cascade="all, delete-orphan",
        order_by="ListingPhoto.position",
    )
    amenities: Mapped[list["Amenity"]] = relationship(secondary=listing_amenities)
    bookings: Mapped[list["Booking"]] = relationship(back_populates="listing", cascade="all, delete-orphan")
    reviews: Mapped[list["Review"]] = relationship(
        back_populates="listing", cascade="all, delete-orphan", order_by="Review.created_at.desc()"
    )


class ListingPhoto(Base):
    __tablename__ = "listing_photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(1000))
    position: Mapped[int] = mapped_column(Integer, default=0)  # display order; 0 = cover photo

    listing: Mapped[Listing] = relationship(back_populates="photos")


class Amenity(Base):
    __tablename__ = "amenities"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    icon: Mapped[str] = mapped_column(String(50))  # icon key the frontend maps to an SVG


class Booking(Base):
    __tablename__ = "bookings"
    __table_args__ = (
        CheckConstraint("check_out > check_in", name="ck_booking_dates_order"),
        CheckConstraint("cancelled_by IS NULL OR cancelled_by IN ('guest', 'host')", name="ck_booking_cancelled_by"),
        CheckConstraint("guests > 0", name="ck_booking_guests_positive"),
        # Overlap queries filter on listing + date range, so index them together
        Index("ix_bookings_listing_dates", "listing_id", "check_in", "check_out"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"))
    guest_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    check_in: Mapped[date] = mapped_column(Date)
    check_out: Mapped[date] = mapped_column(Date)  # exclusive: guest leaves this morning
    guests: Mapped[int] = mapped_column(Integer)
    # Price snapshot at booking time, so later price edits don't rewrite history
    nightly_rate: Mapped[int] = mapped_column(Integer)
    nights: Mapped[int] = mapped_column(Integer)
    cleaning_fee: Mapped[int] = mapped_column(Integer)
    service_fee: Mapped[int] = mapped_column(Integer)
    taxes: Mapped[int] = mapped_column(Integer)
    total_price: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="confirmed")  # confirmed | cancelled
    # Who cancelled ("guest" | "host"); NULL while confirmed. Guests see host cancellations flagged on /trips.
    cancelled_by: Mapped[str | None] = mapped_column(String(10))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    listing: Mapped[Listing] = relationship(back_populates="bookings")
    guest: Mapped[User] = relationship(back_populates="bookings")
    review: Mapped["Review | None"] = relationship(back_populates="booking", uselist=False)


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (CheckConstraint("rating BETWEEN 1 AND 5", name="ck_review_rating_range"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # One review per stay; nullable so seeded legacy reviews needn't map to a booking
    booking_id: Mapped[int | None] = mapped_column(
        ForeignKey("bookings.id", ondelete="SET NULL"), unique=True
    )
    rating: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    listing: Mapped[Listing] = relationship(back_populates="reviews")
    author: Mapped[User] = relationship()
    booking: Mapped[Booking | None] = relationship(back_populates="review")


class WishlistItem(Base):
    __tablename__ = "wishlist_items"
    __table_args__ = (UniqueConstraint("user_id", "listing_id", name="uq_wishlist_user_listing"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    listing_id: Mapped[int] = mapped_column(ForeignKey("listings.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


# ---------------------------------------------------------------- experiences & services
class Experience(Base):
    __tablename__ = "experiences"
    __table_args__ = (
        CheckConstraint("kind IN ('experience', 'service')", name="ck_experience_kind"),
        CheckConstraint("price_per_guest > 0", name="ck_experience_price_positive"),
        CheckConstraint("max_guests > 0", name="ck_experience_guests_positive"),
        CheckConstraint("duration_minutes > 0", name="ck_experience_duration_positive"),
        Index("ix_experiences_kind_city", "kind", "city"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    host_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # experience | service
    title: Mapped[str] = mapped_column(String(200))
    tagline: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(50))  # Food tours, Cooking, Photography, Chefs...
    host_title: Mapped[str] = mapped_column(String(100))  # "Cooking instructor"
    city: Mapped[str] = mapped_column(String(100))
    state: Mapped[str | None] = mapped_column(String(100))
    country: Mapped[str] = mapped_column(String(100))
    meeting_point: Mapped[str] = mapped_column(String(200))  # "Greater Kailash-1"
    address: Mapped[str] = mapped_column(String(300))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    price_per_guest: Mapped[int] = mapped_column(Integer)  # whole rupees
    duration_minutes: Mapped[int] = mapped_column(Integer)
    max_guests: Mapped[int] = mapped_column(Integer)
    language: Mapped[str] = mapped_column(String(50), default="English")
    included: Mapped[str] = mapped_column(String(300))  # "Light bites and speciality drinks"
    free_cancellation: Mapped[bool] = mapped_column(Boolean, default=True)
    private_groups: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    host: Mapped[User] = relationship()
    photos: Mapped[list["ExperiencePhoto"]] = relationship(
        cascade="all, delete-orphan", order_by="ExperiencePhoto.position"
    )
    activities: Mapped[list["ExperienceActivity"]] = relationship(
        cascade="all, delete-orphan", order_by="ExperienceActivity.position"
    )
    slots: Mapped[list["ExperienceSlot"]] = relationship(
        back_populates="experience", cascade="all, delete-orphan", order_by="ExperienceSlot.starts_at"
    )


class ExperiencePhoto(Base):
    __tablename__ = "experience_photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    experience_id: Mapped[int] = mapped_column(ForeignKey("experiences.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(1000))
    position: Mapped[int] = mapped_column(Integer, default=0)


class ExperienceActivity(Base):
    """One step of "What you'll do" (experiences) or one offering (services)."""

    __tablename__ = "experience_activities"

    id: Mapped[int] = mapped_column(primary_key=True)
    experience_id: Mapped[int] = mapped_column(ForeignKey("experiences.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    photo_url: Mapped[str | None] = mapped_column(String(1000))


class ExperienceSlot(Base):
    """A scheduled occurrence. Capacity is shared by every booking on the slot."""

    __tablename__ = "experience_slots"
    __table_args__ = (
        CheckConstraint("capacity > 0", name="ck_slot_capacity_positive"),
        UniqueConstraint("experience_id", "starts_at", name="uq_slot_experience_start"),
        Index("ix_slots_starts_at", "starts_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    experience_id: Mapped[int] = mapped_column(ForeignKey("experiences.id", ondelete="CASCADE"), index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime)
    capacity: Mapped[int] = mapped_column(Integer)

    experience: Mapped[Experience] = relationship(back_populates="slots")
    # the FK cascades in SQLite, so deleting a slot needn't load its bookings first
    bookings: Mapped[list["ExperienceBooking"]] = relationship(back_populates="slot", passive_deletes=True)


class ExperienceBooking(Base):
    __tablename__ = "experience_bookings"
    __table_args__ = (
        CheckConstraint("guests > 0", name="ck_exp_booking_guests_positive"),
        CheckConstraint("cancelled_by IS NULL OR cancelled_by IN ('guest', 'host')", name="ck_exp_booking_cancelled_by"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    slot_id: Mapped[int] = mapped_column(ForeignKey("experience_slots.id", ondelete="CASCADE"), index=True)
    guest_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    guests: Mapped[int] = mapped_column(Integer)
    # Price snapshot at booking time
    price_per_guest: Mapped[int] = mapped_column(Integer)
    subtotal: Mapped[int] = mapped_column(Integer)
    service_fee: Mapped[int] = mapped_column(Integer)
    taxes: Mapped[int] = mapped_column(Integer)
    total_price: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="confirmed")  # confirmed | cancelled
    cancelled_by: Mapped[str | None] = mapped_column(String(10))  # guest | host
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    slot: Mapped[ExperienceSlot] = relationship(back_populates="bookings")
    guest: Mapped[User] = relationship()
    review: Mapped["ExperienceReview | None"] = relationship(back_populates="booking", uselist=False)


class ExperienceReview(Base):
    __tablename__ = "experience_reviews"
    __table_args__ = (CheckConstraint("rating BETWEEN 1 AND 5", name="ck_exp_review_rating_range"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    experience_id: Mapped[int] = mapped_column(ForeignKey("experiences.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    booking_id: Mapped[int | None] = mapped_column(
        ForeignKey("experience_bookings.id", ondelete="SET NULL"), unique=True
    )
    rating: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    author: Mapped[User] = relationship()
    booking: Mapped[ExperienceBooking | None] = relationship(back_populates="review")


class SavedExperience(Base):
    __tablename__ = "saved_experiences"
    __table_args__ = (UniqueConstraint("user_id", "experience_id", name="uq_saved_user_experience"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    experience_id: Mapped[int] = mapped_column(ForeignKey("experiences.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class Conversation(Base):
    """One guest <-> host thread per listing, experience or service.

    `listing_id` / `reservation_id` point into `listings`/`bookings` or
    `experiences`/`experience_bookings` depending on `listing_type`, so they're plain
    integers rather than foreign keys; the API resolves them and copes with deletions.
    """

    __tablename__ = "conversations"
    __table_args__ = (
        CheckConstraint("listing_type IN ('home', 'experience', 'service')", name="ck_conversation_listing_type"),
        CheckConstraint("guest_id <> host_id", name="ck_conversation_two_parties"),
        UniqueConstraint("guest_id", "host_id", "listing_type", "listing_id", name="uq_conversation_thread"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    guest_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    host_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    listing_type: Mapped[str] = mapped_column(String(12))
    listing_id: Mapped[int] = mapped_column(Integer)
    reservation_id: Mapped[int | None] = mapped_column(Integer)  # NULL for a pre-booking inquiry
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)

    guest: Mapped[User] = relationship(foreign_keys=[guest_id])
    host: Mapped[User] = relationship(foreign_keys=[host_id])
    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation", order_by="Message.id", cascade="all, delete-orphan", passive_deletes=True
    )


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint("sender_role IN ('guest', 'host')", name="ck_message_sender_role"),
        Index("ix_messages_conversation_created", "conversation_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"))
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    sender_role: Mapped[str] = mapped_column(String(10))
    # True when the Trust & Safety filter hid something; the original text is never stored
    raw_attempted_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    content: Mapped[str] = mapped_column(Text)  # sanitized
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False)  # nothing but restricted content
    moderation_warning: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    read_at: Mapped[datetime | None] = mapped_column(DateTime)  # set when the recipient opens the thread

    conversation: Mapped[Conversation] = relationship(back_populates="messages")
    sender: Mapped[User] = relationship()
