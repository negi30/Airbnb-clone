"""Experiences & services: search, detail, time slots, booking, reviews, saves.

Both kinds share one table (`Experience.kind`), so every endpoint takes or
returns the kind rather than duplicating the router.
"""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from .. import schemas
from ..database import get_db
from ..deps import get_current_host, get_current_user
from ..models import (
    Experience,
    ExperienceActivity,
    ExperienceBooking,
    ExperiencePhoto,
    ExperienceReview,
    ExperienceSlot,
    SavedExperience,
    User,
)
from ..serializers import (
    experience_booking_out,
    experience_card,
    experience_rating_stats,
    slot_out,
    spots_taken,
)
from ..services.availability import BOOKING_LOCK
from ..services.pricing import calculate_experience_price

router = APIRouter(prefix="/api", tags=["experiences"])

KIND_PATTERN = "^(experience|service)$"
EXPERIENCE_CATEGORIES = [
    "Food tours", "Cooking", "Cultural tours", "Landmarks", "Art & design",
    "Outdoors", "Wellness", "Nightlife",
]
SERVICE_CATEGORIES = [
    "Photography", "Chefs", "Prepared meals", "Massage", "Spa treatments",
    "Training", "Make-up", "Hair", "Nails",
]
CARD_LOAD = (selectinload(Experience.photos), joinedload(Experience.host))
BOOKING_LOAD = (
    joinedload(ExperienceBooking.slot).joinedload(ExperienceSlot.experience).selectinload(Experience.photos),
    joinedload(ExperienceBooking.slot).joinedload(ExperienceSlot.experience).joinedload(Experience.host),
    joinedload(ExperienceBooking.guest),
    selectinload(ExperienceBooking.review),
)


def _load_experience(db: Session, experience_id: int) -> Experience:
    exp = db.scalar(
        select(Experience)
        .where(Experience.id == experience_id)
        .options(*CARD_LOAD, selectinload(Experience.activities))
    )
    if exp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Experience not found")
    return exp


def _booked_guests_subquery():
    """slot_id -> guests already booked (confirmed only)."""
    return (
        select(ExperienceBooking.slot_id, func.sum(ExperienceBooking.guests).label("taken"))
        .where(ExperienceBooking.status == "confirmed")
        .group_by(ExperienceBooking.slot_id)
        .subquery()
    )


# ------------------------------------------------------------------ search
@router.get("/experiences", response_model=schemas.ExperiencePage)
def search_experiences(
    db: Session = Depends(get_db),
    kind: str = Query("experience", pattern=KIND_PATTERN),
    location: str | None = None,
    category: str | None = None,
    date_from: date | None = Query(None, description="Only experiences with a slot on/after this day"),
    date_to: date | None = Query(None, description="…and on/before this day (inclusive)"),
    guests: int | None = Query(None, ge=1),
    sort: str = Query("recommended", pattern="^(recommended|soonest|price_asc|price_desc|rating)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
):
    if date_from and date_to and date_to < date_from:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "date_to must be on or after date_from")

    conditions = [Experience.kind == kind]
    if location:
        term = f"%{location.split(',')[0].strip()}%"
        conditions.append(
            or_(
                Experience.city.ilike(term),
                Experience.state.ilike(term),
                Experience.country.ilike(term),
                Experience.title.ilike(term),
            )
        )
    if category:
        conditions.append(Experience.category == category)

    # earliest bookable slot per experience inside the requested window
    taken = _booked_guests_subquery()
    slot_conditions = [ExperienceSlot.starts_at > datetime.now()]
    if date_from:
        slot_conditions.append(ExperienceSlot.starts_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        slot_conditions.append(
            ExperienceSlot.starts_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time())
        )
    slot_conditions.append(ExperienceSlot.capacity - func.coalesce(taken.c.taken, 0) >= (guests or 1))
    next_slot = (
        select(ExperienceSlot.experience_id, func.min(ExperienceSlot.starts_at).label("next_slot"))
        .outerjoin(taken, taken.c.slot_id == ExperienceSlot.id)
        .where(*slot_conditions)
        .group_by(ExperienceSlot.experience_id)
        .subquery()
    )
    # A date or party size means "only show what I can actually book"
    must_have_slot = bool(date_from or date_to or guests)
    if guests:
        conditions.append(Experience.max_guests >= guests)

    base = select(Experience, next_slot.c.next_slot).where(*conditions)
    base = (
        base.join(next_slot, next_slot.c.experience_id == Experience.id)
        if must_have_slot
        else base.outerjoin(next_slot, next_slot.c.experience_id == Experience.id)
    )
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0

    if sort == "soonest":
        base = base.order_by(next_slot.c.next_slot.is_(None), next_slot.c.next_slot, Experience.id)
    elif sort == "price_asc":
        base = base.order_by(Experience.price_per_guest.asc(), Experience.id)
    elif sort == "price_desc":
        base = base.order_by(Experience.price_per_guest.desc(), Experience.id)
    elif sort == "rating":
        avg = (
            select(ExperienceReview.experience_id, func.avg(ExperienceReview.rating).label("avg"))
            .group_by(ExperienceReview.experience_id)
            .subquery()
        )
        base = base.outerjoin(avg, avg.c.experience_id == Experience.id).order_by(
            func.coalesce(avg.c.avg, 0).desc(), Experience.id
        )
    else:
        base = base.order_by(Experience.id)

    rows = db.execute(base.options(*CARD_LOAD).offset((page - 1) * page_size).limit(page_size)).unique().all()
    stats = experience_rating_stats(db, [e.id for e, _ in rows])
    return schemas.ExperiencePage(
        items=[experience_card(e, stats, next_at) for e, next_at in rows],
        total=total,
        page=page,
        page_size=page_size,
        has_more=page * page_size < total,
    )


@router.get("/experiences/categories")
def experience_categories(
    kind: str = Query("experience", pattern=KIND_PATTERN),
    all: bool = Query(False, description="Include empty categories (the host form needs every option)"),
    db: Session = Depends(get_db),
):
    names = EXPERIENCE_CATEGORIES if kind == "experience" else SERVICE_CATEGORIES
    counts = dict(
        db.execute(
            select(Experience.category, func.count()).where(Experience.kind == kind).group_by(Experience.category)
        ).all()
    )
    return [{"name": c, "count": counts.get(c, 0)} for c in names if all or counts.get(c)]


# ------------------------------------------------------------------ saved (hearts)
@router.get("/experiences/saved", response_model=list[schemas.ExperienceCard])
def saved_experiences(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    exps = db.scalars(
        select(Experience)
        .join(SavedExperience, SavedExperience.experience_id == Experience.id)
        .where(SavedExperience.user_id == user.id)
        .options(*CARD_LOAD)
        .order_by(SavedExperience.created_at.desc())
    ).unique().all()
    stats = experience_rating_stats(db, [e.id for e in exps])
    return [experience_card(e, stats, None) for e in exps]


@router.get("/experiences/saved/ids", response_model=list[int])
def saved_experience_ids(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.scalars(select(SavedExperience.experience_id).where(SavedExperience.user_id == user.id)).all()


@router.put("/experiences/{experience_id}/save", status_code=204)
def save_experience(experience_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if db.get(Experience, experience_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Experience not found")
    try:
        db.add(SavedExperience(user_id=user.id, experience_id=experience_id))
        db.commit()
    except IntegrityError:  # already saved -> idempotent
        db.rollback()
    return Response(status_code=204)


@router.delete("/experiences/{experience_id}/save", status_code=204)
def unsave_experience(experience_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = db.scalar(
        select(SavedExperience).where(
            SavedExperience.user_id == user.id, SavedExperience.experience_id == experience_id
        )
    )
    if item:
        db.delete(item)
        db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------ detail
@router.get("/experiences/{experience_id}", response_model=schemas.ExperienceDetail)
def get_experience(experience_id: int, db: Session = Depends(get_db)):
    exp = _load_experience(db, experience_id)
    stats = experience_rating_stats(db, [exp.id])
    upcoming = db.scalar(
        select(func.min(ExperienceSlot.starts_at)).where(
            ExperienceSlot.experience_id == exp.id, ExperienceSlot.starts_at > datetime.now()
        )
    )
    card = experience_card(exp, stats, upcoming)

    host = exp.host
    host_exp_ids = select(Experience.id).where(Experience.host_id == host.id)
    host_reviews = db.execute(
        select(func.count(ExperienceReview.id), func.avg(ExperienceReview.rating)).where(
            ExperienceReview.experience_id.in_(host_exp_ids)
        )
    ).one()
    host_out = schemas.HostOut.model_validate(host).model_copy(
        update={
            "listing_count": db.scalar(select(func.count()).select_from(host_exp_ids.subquery())),
            "review_count": host_reviews[0],
            "rating": round(float(host_reviews[1]), 2) if host_reviews[1] else None,
        }
    )
    return schemas.ExperienceDetail(
        **{**card.model_dump(), "photos": [p.url for p in exp.photos]},
        tagline=exp.tagline,
        description=exp.description,
        host_title=exp.host_title,
        state=exp.state,
        meeting_point=exp.meeting_point,
        address=exp.address,
        latitude=exp.latitude,
        longitude=exp.longitude,
        max_guests=exp.max_guests,
        language=exp.language,
        included=exp.included,
        free_cancellation=exp.free_cancellation,
        private_groups=exp.private_groups,
        activities=[schemas.ActivityOut.model_validate(a) for a in exp.activities],
        host=host_out,
    )


@router.get("/experiences/{experience_id}/slots", response_model=list[schemas.SlotOut])
def list_slots(
    experience_id: int,
    db: Session = Depends(get_db),
    days: int = Query(30, ge=1, le=90),
    guests: int = Query(1, ge=1),
):
    exp = db.get(Experience, experience_id)
    if exp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Experience not found")
    now = datetime.now()
    slots = db.scalars(
        select(ExperienceSlot)
        .where(
            ExperienceSlot.experience_id == experience_id,
            ExperienceSlot.starts_at > now,
            ExperienceSlot.starts_at < now + timedelta(days=days),
        )
        .order_by(ExperienceSlot.starts_at)
    ).all()
    taken = spots_taken(db, [s.id for s in slots])
    out = [slot_out(s, exp.duration_minutes, taken.get(s.id, 0)) for s in slots]
    return [s for s in out if s.spots_left >= guests]


@router.get("/experiences/{experience_id}/quote", response_model=schemas.ExperienceQuote)
def experience_quote(experience_id: int, guests: int = Query(1, ge=1), db: Session = Depends(get_db)):
    exp = db.get(Experience, experience_id)
    if exp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Experience not found")
    if guests > exp.max_guests:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Up to {exp.max_guests} guests can join")
    return schemas.ExperienceQuote(**calculate_experience_price(exp.price_per_guest, guests).as_dict())


# ------------------------------------------------------------------ reviews
@router.get("/experiences/{experience_id}/reviews", response_model=list[schemas.ReviewOut])
def experience_reviews(experience_id: int, db: Session = Depends(get_db)):
    return db.scalars(
        select(ExperienceReview)
        .where(ExperienceReview.experience_id == experience_id)
        .options(joinedload(ExperienceReview.author))
        .order_by(ExperienceReview.created_at.desc())
    ).all()


@router.post("/experiences/{experience_id}/reviews", response_model=schemas.ReviewOut, status_code=201)
def create_experience_review(
    experience_id: int,
    payload: schemas.ReviewIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    booking = db.scalar(select(ExperienceBooking).where(ExperienceBooking.id == payload.booking_id).options(*BOOKING_LOAD))
    if booking is None or booking.guest_id != user.id or booking.slot.experience_id != experience_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    ends_at = booking.slot.starts_at + timedelta(minutes=booking.slot.experience.duration_minutes)
    if booking.status != "confirmed" or ends_at > datetime.now():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can review this once it's over")
    if booking.review is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "You've already reviewed this")
    review = ExperienceReview(
        experience_id=experience_id, author_id=user.id, booking_id=booking.id,
        rating=payload.rating, comment=payload.comment.strip(),
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return review


# ------------------------------------------------------------------ bookings
def _get_booking_out(db: Session, booking_id: int) -> schemas.ExperienceBookingOut:
    booking = db.scalar(select(ExperienceBooking).where(ExperienceBooking.id == booking_id).options(*BOOKING_LOAD))
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    return _bookings_out(db, [booking])[0]


def _bookings_out(db: Session, bookings: list[ExperienceBooking]) -> list[schemas.ExperienceBookingOut]:
    stats = experience_rating_stats(db, list({b.slot.experience_id for b in bookings}))
    taken = spots_taken(db, list({b.slot_id for b in bookings}))
    return [experience_booking_out(b, stats, taken.get(b.slot_id, 0)) for b in bookings]


@router.post("/experience-bookings", response_model=schemas.ExperienceBookingOut, status_code=201)
def create_experience_booking(
    payload: schemas.ExperienceBookingIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    slot = db.scalar(
        select(ExperienceSlot).where(ExperienceSlot.id == payload.slot_id).options(joinedload(ExperienceSlot.experience))
    )
    if slot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That time slot doesn't exist")
    exp = slot.experience
    if exp.host_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"You can't book your own {exp.kind}")
    if slot.starts_at <= datetime.now():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That time has already started")
    if payload.guests > exp.max_guests:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Up to {exp.max_guests} guests can join")
    price = calculate_experience_price(exp.price_per_guest, payload.guests)
    with BOOKING_LOCK:
        # Server is the source of truth for capacity, not the slot list the UI rendered.
        spots_left = slot.capacity - spots_taken(db, [slot.id]).get(slot.id, 0)
        if payload.guests > spots_left:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "That time is fully booked" if spots_left <= 0 else f"Only {spots_left} spot(s) left at that time",
            )
        booking = ExperienceBooking(
            slot_id=slot.id,
            guest_id=user.id,
            guests=payload.guests,
            price_per_guest=price.price_per_guest,
            subtotal=price.subtotal,
            service_fee=price.service_fee,
            taxes=price.taxes,
            total_price=price.total,
            status="confirmed",
        )
        db.add(booking)
        db.commit()
    return _get_booking_out(db, booking.id)


@router.get("/experience-bookings/me", response_model=list[schemas.ExperienceBookingOut])
def my_experience_bookings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    bookings = db.scalars(
        select(ExperienceBooking)
        .join(ExperienceSlot, ExperienceSlot.id == ExperienceBooking.slot_id)
        .where(ExperienceBooking.guest_id == user.id)
        .options(*BOOKING_LOAD)
        .order_by(ExperienceSlot.starts_at.desc())
    ).unique().all()
    return _bookings_out(db, list(bookings))


def cancel_slot_booking(
    db: Session, booking_id: int, user: User, actor: str | None = None
) -> schemas.ExperienceBookingOut:
    """Soft-cancel an experience/service booking; same actor rules as stays."""
    booking = db.scalar(select(ExperienceBooking).where(ExperienceBooking.id == booking_id).options(*BOOKING_LOAD))
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    is_guest, is_host = user.id == booking.guest_id, user.id == booking.slot.experience.host_id
    actor = actor or ("guest" if is_guest else "host")
    if not (is_guest if actor == "guest" else is_host):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    if booking.status == "cancelled":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Booking is already cancelled")
    if booking.slot.starts_at <= datetime.now():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bookings that have started can't be cancelled")
    booking.status = "cancelled"  # soft-cancel frees the spots
    booking.cancelled_by = actor
    booking.cancelled_at = datetime.now()
    db.commit()
    return _get_booking_out(db, booking.id)


@router.post("/experience-bookings/{booking_id}/cancel", response_model=schemas.ExperienceBookingOut)
@router.patch("/experience-bookings/{booking_id}/cancel", response_model=schemas.ExperienceBookingOut)
def cancel_experience_booking(booking_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return cancel_slot_booking(db, booking_id, user)


# ------------------------------------------------------------------ host CRUD
def _sync_schedule(db: Session, exp: Experience, start_times: list[str], days: int) -> None:
    """Make the next `days` days hold exactly one slot per daily start time.

    Future slots that no longer fit the schedule are removed only if nobody has booked them,
    so editing times never strands a guest. Past slots (and their reviews) are untouched.
    """
    now = datetime.now()
    today = date.today()
    wanted = {
        datetime.combine(today + timedelta(days=d), datetime.strptime(t, "%H:%M").time())
        for d in range(days)
        for t in start_times
    }
    wanted = {w for w in wanted if w > now}
    future = [s for s in exp.slots if s.starts_at > now]
    taken = spots_taken(db, [s.id for s in future if s.id])
    existing = {s.starts_at for s in future}
    for slot in future:
        if slot.starts_at not in wanted and not taken.get(slot.id):
            exp.slots.remove(slot)
        else:
            slot.capacity = max(exp.max_guests, taken.get(slot.id, 0))
    for starts_at in sorted(wanted - existing):
        exp.slots.append(ExperienceSlot(starts_at=starts_at, capacity=exp.max_guests))


def _apply_experience_payload(db: Session, exp: Experience, payload: schemas.ExperienceIn) -> None:
    allowed = EXPERIENCE_CATEGORIES if payload.kind == "experience" else SERVICE_CATEGORIES
    if payload.category not in allowed:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Pick a {payload.kind} category")
    data = payload.model_dump(exclude={"photo_urls", "activities", "start_times", "schedule_days"})
    for field, value in data.items():
        setattr(exp, field, value)
    exp.photos = [ExperiencePhoto(url=url, position=i) for i, url in enumerate(payload.photo_urls)]
    exp.activities = [
        ExperienceActivity(position=i, title=a.title, description=a.description, photo_url=a.photo_url or None)
        for i, a in enumerate(payload.activities)
    ]
    _sync_schedule(db, exp, payload.start_times, payload.schedule_days)


def owned_experience(db: Session, experience_id: int, host: User) -> Experience:
    exp = db.scalar(
        select(Experience)
        .where(Experience.id == experience_id)
        .options(*CARD_LOAD, selectinload(Experience.activities), selectinload(Experience.slots))
    )
    if exp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Experience not found")
    if exp.host_id != host.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"You can only manage your own {exp.kind}s")
    return exp


@router.post("/experiences", response_model=schemas.ExperienceDetail, status_code=201)
def create_experience(payload: schemas.ExperienceIn, db: Session = Depends(get_db), host: User = Depends(get_current_host)):
    exp = Experience(host_id=host.id, slots=[])
    _apply_experience_payload(db, exp, payload)
    db.add(exp)
    db.commit()
    return get_experience(exp.id, db)


@router.put("/experiences/{experience_id}", response_model=schemas.ExperienceDetail)
def update_experience(
    experience_id: int,
    payload: schemas.ExperienceIn,
    db: Session = Depends(get_db),
    host: User = Depends(get_current_host),
):
    exp = owned_experience(db, experience_id, host)
    if payload.kind != exp.kind:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "An experience can't be turned into a service (or back)")
    _apply_experience_payload(db, exp, payload)
    db.commit()
    return get_experience(exp.id, db)


@router.delete("/experiences/{experience_id}", status_code=204)
def delete_experience(experience_id: int, db: Session = Depends(get_db), host: User = Depends(get_current_host)):
    exp = owned_experience(db, experience_id, host)
    upcoming = db.scalar(
        select(func.count(ExperienceBooking.id))
        .join(ExperienceSlot, ExperienceSlot.id == ExperienceBooking.slot_id)
        .where(
            ExperienceSlot.experience_id == exp.id,
            ExperienceBooking.status == "confirmed",
            ExperienceSlot.starts_at > datetime.now(),
        )
    )
    if upcoming:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This {exp.kind} has {upcoming} upcoming booking(s). Cancel them before deleting.",
        )
    db.delete(exp)
    db.commit()
    return Response(status_code=204)
