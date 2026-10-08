"""Booking flow: create (with availability validation), my trips, cancel."""
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload, selectinload

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..models import Booking, Listing, User
from ..serializers import bookings_out
from ..services.availability import BOOKING_LOCK, is_available
from ..services.pricing import calculate_price

router = APIRouter(prefix="/api/bookings", tags=["bookings"])

BOOKING_LOAD = (
    joinedload(Booking.listing).selectinload(Listing.photos),
    joinedload(Booking.listing).joinedload(Listing.host),
    joinedload(Booking.guest),
    selectinload(Booking.review),
)


@router.post("", response_model=schemas.BookingOut, status_code=201)
def create_booking(payload: schemas.BookingIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    listing = db.get(Listing, payload.listing_id)
    if listing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    if listing.host_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't book your own listing")
    if payload.guests > listing.max_guests:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"This place allows up to {listing.max_guests} guests")

    price = calculate_price(listing.price_per_night, listing.cleaning_fee, payload.check_in, payload.check_out)
    with BOOKING_LOCK:
        # The server is the source of truth: never trust the calendar UI alone.
        if not is_available(db, listing.id, payload.check_in, payload.check_out):
            raise HTTPException(status.HTTP_409_CONFLICT, "Those dates are no longer available")
        booking = Booking(
            listing_id=listing.id,
            guest_id=user.id,
            check_in=payload.check_in,
            check_out=payload.check_out,
            guests=payload.guests,
            nightly_rate=price.nightly_rate,
            nights=price.nights,
            cleaning_fee=price.cleaning_fee,
            service_fee=price.service_fee,
            taxes=price.taxes,
            total_price=price.total,
            status="confirmed",
        )
        db.add(booking)
        db.commit()
    return _get_booking_out(db, booking.id)


def _get_booking_out(db: Session, booking_id: int) -> schemas.BookingOut:
    booking = db.scalar(select(Booking).where(Booking.id == booking_id).options(*BOOKING_LOAD))
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    return bookings_out(db, [booking])[0]


@router.get("/me", response_model=list[schemas.BookingOut])
def my_trips(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    bookings = db.scalars(
        select(Booking).where(Booking.guest_id == user.id).options(*BOOKING_LOAD).order_by(Booking.check_in.desc())
    ).unique().all()
    return bookings_out(db, list(bookings))


@router.get("/{booking_id}", response_model=schemas.BookingOut)
def get_booking(booking_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    out = _get_booking_out(db, booking_id)
    booking = db.get(Booking, booking_id)
    if user.id not in (booking.guest_id, booking.listing.host_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    return out


def cancel_stay(db: Session, booking_id: int, user: User, actor: str | None = None) -> schemas.BookingOut:
    """Soft-cancel a stay. `actor` is derived from who's calling unless the route pins it,
    so a guest can never mark their own cancellation as the host's."""
    booking = db.get(Booking, booking_id)
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    is_guest, is_host = user.id == booking.guest_id, user.id == booking.listing.host_id
    actor = actor or ("guest" if is_guest else "host")
    if not (is_guest if actor == "guest" else is_host):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    if booking.status == "cancelled":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Booking is already cancelled")
    if booking.check_in <= date.today():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Stays that have started can't be cancelled")
    booking.status = "cancelled"  # soft-cancel keeps history; frees the dates
    booking.cancelled_by = actor
    booking.cancelled_at = datetime.now()
    db.commit()
    return _get_booking_out(db, booking.id)


@router.post("/{booking_id}/cancel", response_model=schemas.BookingOut)
@router.patch("/{booking_id}/cancel", response_model=schemas.BookingOut)
def cancel_booking(booking_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    # guest or the listing's host may cancel; cancelled_by records which one did
    return cancel_stay(db, booking_id, user)
