"""Users (account switcher), wishlists, amenities/categories, image uploads."""
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..models import Amenity, Listing, User, WishlistItem
from ..serializers import listing_card, rating_stats

router = APIRouter(prefix="/api", tags=["misc"])

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "static" / "uploads"
MAX_UPLOAD_BYTES = 5 * 1024 * 1024

CATEGORIES = [
    "Trending", "Beachfront", "Amazing views", "Cabins", "Amazing pools", "Countryside",
    "Lakefront", "Castles", "Tiny homes", "Treehouses", "Mansions", "Tropical",
    "Camping", "Historical homes", "Skiing", "Iconic cities",
]
PROPERTY_TYPES = ["House", "Apartment", "Villa", "Cabin", "Cottage", "Guesthouse", "Hotel"]


# ---------- users ----------
@router.get("/users", response_model=list[schemas.UserOut])
def list_users(db: Session = Depends(get_db)):
    return db.scalars(select(User).order_by(User.is_host, User.id)).all()


@router.get("/users/me", response_model=schemas.UserOut)
def me(user: User = Depends(get_current_user)):
    return user


# ---------- metadata ----------
@router.get("/amenities", response_model=list[schemas.AmenityOut])
def amenities(db: Session = Depends(get_db)):
    return db.scalars(select(Amenity).order_by(Amenity.id)).all()


@router.get("/categories")
def categories(db: Session = Depends(get_db)):
    counts = dict(db.execute(select(Listing.category, func.count()).group_by(Listing.category)).all())
    return [{"name": c, "count": counts.get(c, 0)} for c in CATEGORIES]


@router.get("/property-types")
def property_types():
    return PROPERTY_TYPES


# ---------- wishlists ----------
@router.get("/wishlists", response_model=list[schemas.ListingCard])
def wishlist(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    listings = db.scalars(
        select(Listing)
        .join(WishlistItem, WishlistItem.listing_id == Listing.id)
        .where(WishlistItem.user_id == user.id)
        .options(selectinload(Listing.photos), joinedload(Listing.host))
        .order_by(WishlistItem.created_at.desc())
    ).unique().all()
    stats = rating_stats(db, [l.id for l in listings])
    return [listing_card(l, stats) for l in listings]


@router.get("/wishlists/ids", response_model=list[int])
def wishlist_ids(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return db.scalars(select(WishlistItem.listing_id).where(WishlistItem.user_id == user.id)).all()


@router.put("/wishlists/{listing_id}", status_code=204)
def save_to_wishlist(listing_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if db.get(Listing, listing_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
    try:
        db.add(WishlistItem(user_id=user.id, listing_id=listing_id))
        db.commit()
    except IntegrityError:  # already saved -> idempotent
        db.rollback()
    return Response(status_code=204)


@router.delete("/wishlists/{listing_id}", status_code=204)
def remove_from_wishlist(listing_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    item = db.scalar(
        select(WishlistItem).where(WishlistItem.user_id == user.id, WishlistItem.listing_id == listing_id)
    )
    if item:
        db.delete(item)
        db.commit()
    return Response(status_code=204)


# ---------- uploads ----------
@router.post("/uploads")
async def upload_image(request: Request, file: UploadFile = File(...), _: User = Depends(get_current_user)):
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only image files are allowed")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Images must be under 5 MB")
    ext = Path(file.filename or "").suffix.lower() or ".jpg"
    if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        ext = ".jpg"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{ext}"
    (UPLOAD_DIR / name).write_bytes(data)
    return {"url": str(request.base_url).rstrip("/") + f"/static/uploads/{name}"}
