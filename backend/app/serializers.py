"""Turn ORM objects into response schemas (plus rating aggregation)."""
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import schemas
from .models import Booking, Experience, ExperienceBooking, ExperienceReview, ExperienceSlot, Listing, Review

RatingStats = dict[int, tuple[float | None, int]]


def rating_stats(db: Session, listing_ids: list[int]) -> RatingStats:
    """One grouped query: listing_id -> (average rating, review count)."""
    if not listing_ids:
        return {}
    rows = db.execute(
        select(Review.listing_id, func.avg(Review.rating), func.count(Review.id))
        .where(Review.listing_id.in_(listing_ids))
        .group_by(Review.listing_id)
    )
    stats: RatingStats = {lid: (None, 0) for lid in listing_ids}
    for lid, avg, count in rows:
        stats[lid] = (round(float(avg), 2), count)
    return stats


def listing_card(listing: Listing, stats: RatingStats) -> schemas.ListingCard:
    rating, count = stats.get(listing.id, (None, 0))
    return schemas.ListingCard(
        id=listing.id,
        title=listing.title,
        city=listing.city,
        state=listing.state,
        country=listing.country,
        property_type=listing.property_type,
        category=listing.category,
        price_per_night=listing.price_per_night,
        rating=rating,
        review_count=count,
        photos=[p.url for p in listing.photos[:5]],
        latitude=listing.latitude,
        longitude=listing.longitude,
        bedrooms=listing.bedrooms,
        beds=listing.beds,
        max_guests=listing.max_guests,
        host_name=listing.host.name,
        host_is_superhost=listing.host.is_superhost,
    )


def booking_out(booking: Booking, stats: RatingStats) -> schemas.BookingOut:
    return schemas.BookingOut(
        id=booking.id,
        listing=listing_card(booking.listing, stats),
        guest=schemas.UserOut.model_validate(booking.guest),
        check_in=booking.check_in,
        check_out=booking.check_out,
        guests=booking.guests,
        nightly_rate=booking.nightly_rate,
        nights=booking.nights,
        cleaning_fee=booking.cleaning_fee,
        service_fee=booking.service_fee,
        taxes=booking.taxes,
        total_price=booking.total_price,
        status=booking.status,
        cancelled_by=booking.cancelled_by,
        cancelled_at=booking.cancelled_at,
        created_at=booking.created_at,
        has_review=booking.review is not None,
    )


def bookings_out(db: Session, bookings: list[Booking]) -> list[schemas.BookingOut]:
    stats = rating_stats(db, list({b.listing_id for b in bookings}))
    return [booking_out(b, stats) for b in bookings]


# ---------- experiences & services ----------
def experience_rating_stats(db: Session, experience_ids: list[int]) -> RatingStats:
    """One grouped query: experience_id -> (average rating, review count)."""
    if not experience_ids:
        return {}
    rows = db.execute(
        select(ExperienceReview.experience_id, func.avg(ExperienceReview.rating), func.count(ExperienceReview.id))
        .where(ExperienceReview.experience_id.in_(experience_ids))
        .group_by(ExperienceReview.experience_id)
    )
    stats: RatingStats = {eid: (None, 0) for eid in experience_ids}
    for eid, avg, count in rows:
        stats[eid] = (round(float(avg), 2), count)
    return stats


def spots_taken(db: Session, slot_ids: list[int]) -> dict[int, int]:
    """slot_id -> guests on confirmed bookings."""
    if not slot_ids:
        return {}
    rows = db.execute(
        select(ExperienceBooking.slot_id, func.sum(ExperienceBooking.guests))
        .where(ExperienceBooking.slot_id.in_(slot_ids), ExperienceBooking.status == "confirmed")
        .group_by(ExperienceBooking.slot_id)
    )
    return {sid: int(total) for sid, total in rows}


def experience_card(exp: Experience, stats: RatingStats, next_slot: datetime | None) -> schemas.ExperienceCard:
    rating, count = stats.get(exp.id, (None, 0))
    return schemas.ExperienceCard(
        id=exp.id,
        kind=exp.kind,
        title=exp.title,
        category=exp.category,
        city=exp.city,
        country=exp.country,
        price_per_guest=exp.price_per_guest,
        duration_minutes=exp.duration_minutes,
        rating=rating,
        review_count=count,
        photos=[p.url for p in exp.photos[:5]],
        host_name=exp.host.name,
        next_slot=next_slot,
    )


def slot_out(slot: ExperienceSlot, duration_minutes: int, taken: int) -> schemas.SlotOut:
    return schemas.SlotOut(
        id=slot.id,
        starts_at=slot.starts_at,
        ends_at=slot.starts_at + timedelta(minutes=duration_minutes),
        capacity=slot.capacity,
        spots_left=max(0, slot.capacity - taken),
    )


def experience_booking_out(booking: ExperienceBooking, stats: RatingStats, taken: int) -> schemas.ExperienceBookingOut:
    exp = booking.slot.experience
    return schemas.ExperienceBookingOut(
        id=booking.id,
        experience=experience_card(exp, stats, booking.slot.starts_at),
        guest=schemas.UserOut.model_validate(booking.guest),
        slot=slot_out(booking.slot, exp.duration_minutes, taken),
        guests=booking.guests,
        price_per_guest=booking.price_per_guest,
        subtotal=booking.subtotal,
        service_fee=booking.service_fee,
        taxes=booking.taxes,
        total_price=booking.total_price,
        status=booking.status,
        cancelled_by=booking.cancelled_by,
        cancelled_at=booking.cancelled_at,
        created_at=booking.created_at,
        has_review=booking.review is not None,
    )
