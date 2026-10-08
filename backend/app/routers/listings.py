"""Public listing endpoints (search, detail, quote, reviews) + host CRUD."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from .. import schemas
from ..database import get_db
from ..deps import get_current_host, get_current_user
from ..models import Amenity, Booking, Listing, ListingPhoto, Review, User, listing_amenities
from ..serializers import listing_card, rating_stats
from .misc import CATEGORIES, PROPERTY_TYPES
from ..services.availability import booked_ranges, is_available, overlapping_bookings_clause, stay_dates_error
from ..services.pricing import calculate_price

router = APIRouter(prefix="/api/listings", tags=["listings"])


def _csv_ints(value: str | None) -> list[int]:
    return [int(v) for v in value.split(",") if v.strip().isdigit()] if value else []


def _csv_strs(value: str | None) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()] if value else []


def _load_listing(db: Session, listing_id: int) -> Listing:
    listing = db.scalar(
        select(Listing)
        .where(Listing.id == listing_id)
        .options(selectinload(Listing.photos), selectinload(Listing.amenities), joinedload(Listing.host))
    )
    if listing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    return listing


# ------------------------------------------------------------------ search
@router.get("", response_model=schemas.ListingPage)
def search_listings(
    db: Session = Depends(get_db),
    location: str | None = None,
    check_in: date | None = None,
    check_out: date | None = None,
    guests: int | None = Query(None, ge=1),
    category: str | None = None,
    property_types: str | None = Query(None, description="Comma-separated, e.g. Villa,Cabin"),
    amenities: str | None = Query(None, description="Comma-separated amenity ids (all required)"),
    min_price: int | None = Query(None, ge=0),
    max_price: int | None = Query(None, ge=0),
    bedrooms: int | None = Query(None, ge=0),
    beds: int | None = Query(None, ge=0),
    bathrooms: int | None = Query(None, ge=0),
    superhost: bool = False,
    sort: str = Query("recommended", pattern="^(recommended|price_asc|price_desc|rating)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
):
    conditions = []

    if location:
        # "Goa, India" -> match on the most specific part ("Goa")
        term = f"%{location.split(',')[0].strip()}%"
        conditions.append(
            or_(
                Listing.city.ilike(term),
                Listing.state.ilike(term),
                Listing.country.ilike(term),
                Listing.title.ilike(term),
            )
        )
    if guests:
        conditions.append(Listing.max_guests >= guests)
    if category:
        conditions.append(Listing.category == category)
    if types := _csv_strs(property_types):
        conditions.append(Listing.property_type.in_(types))
    if min_price is not None:
        conditions.append(Listing.price_per_night >= min_price)
    if max_price is not None:
        conditions.append(Listing.price_per_night <= max_price)
    if bedrooms:
        conditions.append(Listing.bedrooms >= bedrooms)
    if beds:
        conditions.append(Listing.beds >= beds)
    if bathrooms:
        conditions.append(Listing.bathrooms >= bathrooms)
    if superhost:
        conditions.append(Listing.host.has(User.is_superhost.is_(True)))
    if amenity_ids := _csv_ints(amenities):
        # listings that have ALL selected amenities
        has_all = (
            select(listing_amenities.c.listing_id)
            .where(listing_amenities.c.amenity_id.in_(amenity_ids))
            .group_by(listing_amenities.c.listing_id)
            .having(func.count() == len(set(amenity_ids)))
        )
        conditions.append(Listing.id.in_(has_all))
    if check_in and check_out:
        if check_out <= check_in:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "check_out must be after check_in")
        # exclude listings with any overlapping active booking
        conditions.append(
            ~exists().where(
                and_(Booking.listing_id == Listing.id, overlapping_bookings_clause(check_in, check_out))
            )
        )

    total = db.scalar(select(func.count(Listing.id)).where(*conditions)) or 0

    stmt = select(Listing).where(*conditions).options(selectinload(Listing.photos), joinedload(Listing.host))
    if sort == "price_asc":
        stmt = stmt.order_by(Listing.price_per_night.asc(), Listing.id)
    elif sort == "price_desc":
        stmt = stmt.order_by(Listing.price_per_night.desc(), Listing.id)
    elif sort == "rating":
        avg = (
            select(Review.listing_id, func.avg(Review.rating).label("avg"))
            .group_by(Review.listing_id)
            .subquery()
        )
        stmt = stmt.outerjoin(avg, avg.c.listing_id == Listing.id).order_by(
            func.coalesce(avg.c.avg, 0).desc(), Listing.id
        )
    else:
        stmt = stmt.order_by(Listing.id)

    listings = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).unique().all()
    stats = rating_stats(db, [l.id for l in listings])
    return schemas.ListingPage(
        items=[listing_card(l, stats) for l in listings],
        total=total,
        page=page,
        page_size=page_size,
        has_more=page * page_size < total,
    )


@router.get("/price-stats")
def price_stats(db: Session = Depends(get_db), buckets: int = Query(30, ge=5, le=60)):
    """Min/max nightly price + histogram for the filter modal's price slider."""
    prices = db.scalars(select(Listing.price_per_night)).all()
    if not prices:
        return {"min": 0, "max": 0, "histogram": []}
    lo, hi = min(prices), max(prices)
    width = max(1, (hi - lo) / buckets)
    hist = [0] * buckets
    for p in prices:
        hist[min(buckets - 1, int((p - lo) / width))] += 1
    return {"min": lo, "max": hi, "histogram": hist}


# ------------------------------------------------------------------ detail
@router.get("/{listing_id}", response_model=schemas.ListingDetail)
def get_listing(listing_id: int, db: Session = Depends(get_db)):
    listing = _load_listing(db, listing_id)
    stats = rating_stats(db, [listing.id])
    card = listing_card(listing, stats)

    host = listing.host
    host_listing_ids = select(Listing.id).where(Listing.host_id == host.id)
    host_reviews = db.execute(
        select(func.count(Review.id), func.avg(Review.rating)).where(Review.listing_id.in_(host_listing_ids))
    ).one()
    host_out = schemas.HostOut.model_validate(host).model_copy(
        update={
            "listing_count": db.scalar(select(func.count()).select_from(host_listing_ids.subquery())),
            "review_count": host_reviews[0],
            "rating": round(float(host_reviews[1]), 2) if host_reviews[1] else None,
        }
    )

    return schemas.ListingDetail(
        **{**card.model_dump(), "photos": [p.url for p in listing.photos]},  # detail page gets every photo
        description=listing.description,
        cleaning_fee=listing.cleaning_fee,
        bathrooms=listing.bathrooms,
        amenities=[schemas.AmenityOut.model_validate(a) for a in listing.amenities],
        host=host_out,
        booked_ranges=[
            schemas.DateRange(check_in=a, check_out=b) for a, b in booked_ranges(db, listing.id, date.today())
        ],
        created_at=listing.created_at,
    )


@router.get("/{listing_id}/quote", response_model=schemas.Quote)
def quote(
    listing_id: int,
    check_in: date,
    check_out: date,
    guests: int = Query(1, ge=1),
    db: Session = Depends(get_db),
):
    listing = db.get(Listing, listing_id)
    if listing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    if guests > listing.max_guests:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"This place allows up to {listing.max_guests} guests")
    if error := stay_dates_error(check_in, check_out):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, error)
    price = calculate_price(listing.price_per_night, listing.cleaning_fee, check_in, check_out)
    return schemas.Quote(available=is_available(db, listing_id, check_in, check_out), **price.as_dict())


# ------------------------------------------------------------------ reviews
@router.get("/{listing_id}/reviews", response_model=list[schemas.ReviewOut])
def list_reviews(listing_id: int, db: Session = Depends(get_db)):
    return db.scalars(
        select(Review)
        .where(Review.listing_id == listing_id)
        .options(joinedload(Review.author))
        .order_by(Review.created_at.desc())
    ).all()


@router.post("/{listing_id}/reviews", response_model=schemas.ReviewOut, status_code=201)
def create_review(
    listing_id: int,
    payload: schemas.ReviewIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    booking = db.get(Booking, payload.booking_id)
    if booking is None or booking.guest_id != user.id or booking.listing_id != listing_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Booking not found")
    if booking.status != "confirmed" or booking.check_out > date.today():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can review a stay once it's completed")
    if booking.review is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "You've already reviewed this stay")
    review = Review(
        listing_id=listing_id, author_id=user.id, booking_id=booking.id,
        rating=payload.rating, comment=payload.comment.strip(),
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return review


# ------------------------------------------------------------------ host CRUD
def _apply_listing_payload(db: Session, listing: Listing, payload: schemas.ListingIn) -> None:
    if payload.category not in CATEGORIES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick one of the listed categories")
    if payload.property_type not in PROPERTY_TYPES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Pick one of the listed property types")
    data = payload.model_dump(exclude={"amenity_ids", "photo_urls"})
    for field, value in data.items():
        setattr(listing, field, value)
    listing.amenities = list(db.scalars(select(Amenity).where(Amenity.id.in_(payload.amenity_ids))))
    # replace photo set, preserving the order the host chose
    listing.photos = [ListingPhoto(url=url, position=i) for i, url in enumerate(payload.photo_urls)]


@router.post("", response_model=schemas.ListingDetail, status_code=201)
def create_listing(payload: schemas.ListingIn, db: Session = Depends(get_db), host: User = Depends(get_current_host)):
    listing = Listing(host_id=host.id)
    _apply_listing_payload(db, listing, payload)
    db.add(listing)
    db.commit()
    return get_listing(listing.id, db)


def _owned_listing(db: Session, listing_id: int, host: User) -> Listing:
    listing = _load_listing(db, listing_id)
    if listing.host_id != host.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only manage your own listings")
    return listing


@router.put("/{listing_id}", response_model=schemas.ListingDetail)
def update_listing(
    listing_id: int,
    payload: schemas.ListingIn,
    db: Session = Depends(get_db),
    host: User = Depends(get_current_host),
):
    listing = _owned_listing(db, listing_id, host)
    _apply_listing_payload(db, listing, payload)
    db.commit()
    return get_listing(listing.id, db)


@router.delete("/{listing_id}", status_code=204)
def delete_listing(listing_id: int, db: Session = Depends(get_db), host: User = Depends(get_current_host)):
    listing = _owned_listing(db, listing_id, host)
    upcoming = db.scalar(
        select(func.count(Booking.id)).where(
            Booking.listing_id == listing.id,
            Booking.status == "confirmed",
            Booking.check_out > date.today(),
        )
    )
    if upcoming:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This listing has {upcoming} upcoming reservation(s). Cancel them before deleting.",
        )
    db.delete(listing)
    db.commit()
    return Response(status_code=204)
