"""Host dashboard: owned listings, experiences and services with stats, and reservations on them."""
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from .. import schemas
from ..database import get_db
from ..deps import get_current_host
from ..models import Booking, Experience, ExperienceBooking, ExperienceSlot, Listing, User
from ..serializers import bookings_out, experience_card, experience_rating_stats, listing_card, rating_stats
from .bookings import BOOKING_LOAD, cancel_stay
from .experiences import BOOKING_LOAD as EXP_BOOKING_LOAD
from .experiences import CARD_LOAD, KIND_PATTERN, _bookings_out, cancel_slot_booking, owned_experience

router = APIRouter(prefix="/api/host", tags=["host"])


@router.get("/listings", response_model=list[schemas.HostListingOut])
def my_listings(db: Session = Depends(get_db), host: User = Depends(get_current_host)):
    listings = db.scalars(
        select(Listing)
        .where(Listing.host_id == host.id)
        .options(selectinload(Listing.photos), joinedload(Listing.host))
        .order_by(Listing.created_at.desc())
    ).unique().all()
    ids = [l.id for l in listings]
    stats = rating_stats(db, ids)

    today = date.today()
    agg = {
        row.listing_id: row
        for row in db.execute(
            select(
                Booking.listing_id,
                # not started yet: same meaning as "Upcoming" on the dashboard and for experiences
                func.sum(case((Booking.check_in > today, 1), else_=0)).label("upcoming"),
                # host payout = what the guest paid minus platform service fee and taxes
                func.sum(Booking.total_price - Booking.service_fee - Booking.taxes).label("earnings"),
            )
            .where(Booking.listing_id.in_(ids), Booking.status == "confirmed")
            .group_by(Booking.listing_id)
        )
    }
    out = []
    for l in listings:
        row = agg.get(l.id)
        out.append(
            schemas.HostListingOut(
                **listing_card(l, stats).model_dump(),
                upcoming_bookings=int(row.upcoming or 0) if row else 0,
                total_earnings=int(row.earnings or 0) if row else 0,
            )
        )
    return out


@router.get("/bookings", response_model=list[schemas.BookingOut])
def reservations(db: Session = Depends(get_db), host: User = Depends(get_current_host)):
    bookings = db.scalars(
        select(Booking)
        .join(Listing, Booking.listing_id == Listing.id)
        .where(Listing.host_id == host.id)
        .options(*BOOKING_LOAD)
        .order_by(Booking.check_in.desc())
    ).unique().all()
    return bookings_out(db, list(bookings))


# ---------------------------------------------------------------- experiences & services
@router.get("/experiences", response_model=list[schemas.HostExperienceOut])
def my_experiences(
    kind: str | None = Query(None, pattern=KIND_PATTERN),
    db: Session = Depends(get_db),
    host: User = Depends(get_current_host),
):
    conditions = [Experience.host_id == host.id]
    if kind:
        conditions.append(Experience.kind == kind)
    exps = db.scalars(
        select(Experience).where(*conditions).options(*CARD_LOAD).order_by(Experience.created_at.desc())
    ).unique().all()
    ids = [e.id for e in exps]
    stats = experience_rating_stats(db, ids)
    now = datetime.now()

    bookings = {
        row.experience_id: row
        for row in db.execute(
            select(
                ExperienceSlot.experience_id,
                func.sum(case((ExperienceSlot.starts_at > now, 1), else_=0)).label("upcoming"),
                func.sum(ExperienceBooking.subtotal).label("earnings"),  # host payout before platform fees
            )
            .join(ExperienceSlot, ExperienceSlot.id == ExperienceBooking.slot_id)
            .where(ExperienceSlot.experience_id.in_(ids), ExperienceBooking.status == "confirmed")
            .group_by(ExperienceSlot.experience_id)
        )
    }
    slots = dict(
        db.execute(
            select(ExperienceSlot.experience_id, func.count(ExperienceSlot.id))
            .where(ExperienceSlot.experience_id.in_(ids), ExperienceSlot.starts_at > now)
            .group_by(ExperienceSlot.experience_id)
        ).all()
    )
    next_slots = dict(
        db.execute(
            select(ExperienceSlot.experience_id, func.min(ExperienceSlot.starts_at))
            .where(ExperienceSlot.experience_id.in_(ids), ExperienceSlot.starts_at > now)
            .group_by(ExperienceSlot.experience_id)
        ).all()
    )
    out = []
    for e in exps:
        row = bookings.get(e.id)
        out.append(
            schemas.HostExperienceOut(
                **experience_card(e, stats, next_slots.get(e.id)).model_dump(),
                max_guests=e.max_guests,
                upcoming_bookings=int(row.upcoming or 0) if row else 0,
                upcoming_slots=slots.get(e.id, 0),
                total_earnings=int(row.earnings or 0) if row else 0,
            )
        )
    return out


@router.get("/experiences/{experience_id}", response_model=schemas.HostExperienceForm)
def experience_form(experience_id: int, db: Session = Depends(get_db), host: User = Depends(get_current_host)):
    """Everything the edit form needs, including the daily schedule inferred from future slots."""
    exp = owned_experience(db, experience_id, host)
    now = datetime.now()
    times = sorted({s.starts_at.strftime("%H:%M") for s in exp.slots if s.starts_at > now})
    return schemas.HostExperienceForm.model_construct(
        id=exp.id,
        kind=exp.kind,
        title=exp.title,
        tagline=exp.tagline,
        description=exp.description,
        category=exp.category,
        host_title=exp.host_title,
        city=exp.city,
        state=exp.state,
        country=exp.country,
        meeting_point=exp.meeting_point,
        address=exp.address,
        latitude=exp.latitude,
        longitude=exp.longitude,
        price_per_guest=exp.price_per_guest,
        duration_minutes=exp.duration_minutes,
        max_guests=exp.max_guests,
        language=exp.language,
        included=exp.included,
        private_groups=exp.private_groups,
        photo_urls=[p.url for p in exp.photos],
        activities=[
            schemas.ActivityIn.model_construct(title=a.title, description=a.description, photo_url=a.photo_url)
            for a in exp.activities
        ],
        start_times=times or ["10:00"],
        schedule_days=28,
    )


@router.get("/experience-bookings", response_model=list[schemas.ExperienceBookingOut])
def experience_reservations(
    kind: str | None = Query(None, pattern=KIND_PATTERN),
    db: Session = Depends(get_db),
    host: User = Depends(get_current_host),
):
    conditions = [Experience.host_id == host.id]
    if kind:
        conditions.append(Experience.kind == kind)
    bookings = db.scalars(
        select(ExperienceBooking)
        .join(ExperienceSlot, ExperienceSlot.id == ExperienceBooking.slot_id)
        .join(Experience, Experience.id == ExperienceSlot.experience_id)
        .where(*conditions)
        .options(*EXP_BOOKING_LOAD)
        .order_by(ExperienceSlot.starts_at.desc())
    ).unique().all()
    return _bookings_out(db, list(bookings))


# ---------------------------------------------------------------- host-initiated cancellation
@router.patch("/reservations/{kind}/{booking_id}/cancel")
def host_cancel(
    kind: str = Path(pattern="^(home|experience|service)$"),
    booking_id: int = Path(),
    db: Session = Depends(get_db),
    host: User = Depends(get_current_host),
) -> schemas.BookingOut | schemas.ExperienceBookingOut:
    """Cancel a guest's reservation as the host. Recorded as cancelled_by='host' so the
    guest's Trips page explains it and shows the refund; frees the dates/spots."""
    if kind == "home":
        return cancel_stay(db, booking_id, host, actor="host")
    # experiences and services share one bookings table (and id space), so check the kind matches the URL
    kind_of = db.scalar(
        select(Experience.kind)
        .join(ExperienceSlot, ExperienceSlot.experience_id == Experience.id)
        .join(ExperienceBooking, ExperienceBooking.slot_id == ExperienceSlot.id)
        .where(ExperienceBooking.id == booking_id)
    )
    if kind_of != kind:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    return cancel_slot_booking(db, booking_id, host, actor="host")
