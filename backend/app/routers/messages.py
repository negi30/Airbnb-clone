"""Guest <-> host messaging. Every message passes the Trust & Safety filter
(`services.moderation`) before it is stored: obvious contact details are refused with
422 CONTACT_INFO_PROHIBITED, obfuscated ones are redacted and flagged."""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session, joinedload, selectinload

from .. import schemas
from ..database import get_db
from ..deps import get_current_user
from ..models import (
    Booking,
    Conversation,
    Experience,
    ExperienceBooking,
    ExperienceSlot,
    Listing,
    Message,
    User,
)
from ..services.moderation import sanitize_and_validate_message

router = APIRouter(prefix="/api/conversations", tags=["messages"])

THREAD_LOAD = (joinedload(Conversation.guest), joinedload(Conversation.host))


# ------------------------------------------------------------------ resolving targets
def _listing(db: Session, kind: str, listing_id: int) -> Listing | Experience | None:
    if kind == "home":
        return db.scalar(select(Listing).where(Listing.id == listing_id).options(selectinload(Listing.photos)))
    exp = db.scalar(select(Experience).where(Experience.id == listing_id).options(selectinload(Experience.photos)))
    return exp if exp is not None and exp.kind == kind else None


def _reservation(db: Session, kind: str, reservation_id: int) -> Booking | ExperienceBooking | None:
    if kind == "home":
        return db.get(Booking, reservation_id)
    return db.scalar(
        select(ExperienceBooking)
        .where(ExperienceBooking.id == reservation_id)
        .options(joinedload(ExperienceBooking.slot).joinedload(ExperienceSlot.experience))
    )


def _reservation_listing_id(kind: str, r: Booking | ExperienceBooking) -> int:
    return r.listing_id if kind == "home" else r.slot.experience_id


def _latest_reservation_id(db: Session, kind: str, listing_id: int, guest_id: int) -> int | None:
    """Most recent booking this guest has for the listing, so an inquiry thread picks up its trip."""
    if kind == "home":
        q = select(Booking.id).where(Booking.listing_id == listing_id, Booking.guest_id == guest_id)
        return db.scalar(q.order_by(Booking.check_in.desc()).limit(1))
    q = (
        select(ExperienceBooking.id)
        .join(ExperienceSlot, ExperienceSlot.id == ExperienceBooking.slot_id)
        .where(ExperienceSlot.experience_id == listing_id, ExperienceBooking.guest_id == guest_id)
    )
    return db.scalar(q.order_by(ExperienceSlot.starts_at.desc()).limit(1))


def _slot_end(r: ExperienceBooking) -> datetime:
    return r.slot.starts_at + timedelta(minutes=r.slot.experience.duration_minutes)


def _status(r: Booking | ExperienceBooking | None) -> str:
    if r is None:
        return "inquiry"
    if r.status == "cancelled":
        return "cancelled_by_host" if r.cancelled_by == "host" else "cancelled_by_guest"
    if isinstance(r, Booking):
        today = date.today()
        return "completed" if r.check_out <= today else "in_progress" if r.check_in <= today else "upcoming"
    now = datetime.now()
    return "completed" if _slot_end(r) <= now else "in_progress" if r.slot.starts_at <= now else "upcoming"


def _listing_out(kind: str, item: Listing | Experience | None) -> schemas.ConversationListing | None:
    if item is None:
        return None
    return schemas.ConversationListing(
        type=kind, id=item.id, title=item.title, photo=item.photos[0].url if item.photos else None,
        city=item.city, country=item.country,
    )


def _reservation_out(r: Booking | ExperienceBooking | None) -> schemas.ConversationReservation | None:
    if r is None:
        return None
    base = {"id": r.id, "status": _status(r), "guests": r.guests, "total_price": r.total_price}
    if isinstance(r, Booking):
        return schemas.ConversationReservation(**base, check_in=r.check_in, check_out=r.check_out)
    return schemas.ConversationReservation(**base, starts_at=r.slot.starts_at, ends_at=_slot_end(r))


# ------------------------------------------------------------------ serializing
def _role(c: Conversation, user: User) -> str:
    return "guest" if c.guest_id == user.id else "host"


def _owned(db: Session, conversation_id: int, user: User) -> Conversation:
    c = db.scalar(select(Conversation).where(Conversation.id == conversation_id).options(*THREAD_LOAD))
    # 404 rather than 403: don't reveal that someone else's thread exists
    if c is None or user.id not in (c.guest_id, c.host_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return c


def _unread_counts(db: Session, user: User, ids: list[int]) -> dict[int, int]:
    if not ids:
        return {}
    rows = db.execute(
        select(Message.conversation_id, func.count())
        .where(Message.conversation_id.in_(ids), Message.sender_id != user.id, Message.read_at.is_(None))
        .group_by(Message.conversation_id)
    ).all()
    return dict(rows)


def _summary(db: Session, c: Conversation, user: User, last: Message | None, unread: int) -> dict:
    role = _role(c, user)
    reservation = _reservation(db, c.listing_type, c.reservation_id) if c.reservation_id else None
    return {
        "id": c.id,
        "role": role,
        "counterpart": c.host if role == "guest" else c.guest,
        "listing": _listing_out(c.listing_type, _listing(db, c.listing_type, c.listing_id)),
        "status": _status(reservation),
        "last_message": last,
        "unread_count": unread,
        "updated_at": c.updated_at,
        "_reservation": reservation,
    }


# ------------------------------------------------------------------ endpoints
@router.get("", response_model=list[schemas.ConversationSummary])
def list_conversations(
    role: str | None = Query(None, pattern="^(guest|host)$", description="only threads where you're the guest / host"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    side = {"guest": Conversation.guest_id == user.id, "host": Conversation.host_id == user.id}
    where = side[role] if role else or_(*side.values())
    # threads opened but never written in stay out of the inbox
    has_messages = select(Message.id).where(Message.conversation_id == Conversation.id).exists()
    threads = db.scalars(
        select(Conversation).where(where, has_messages).options(*THREAD_LOAD).order_by(Conversation.updated_at.desc())
    ).all()
    ids = [c.id for c in threads]
    last_ids = select(func.max(Message.id)).where(Message.conversation_id.in_(ids)).group_by(Message.conversation_id)
    last = {m.conversation_id: m for m in db.scalars(select(Message).where(Message.id.in_(last_ids)))}
    unread = _unread_counts(db, user, ids)
    out = []
    for c in threads:
        s = _summary(db, c, user, last.get(c.id), unread.get(c.id, 0))
        s.pop("_reservation")
        out.append(s)
    return out


@router.get("/unread-count", response_model=schemas.UnreadCount)
def unread_count(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    count = db.scalar(
        select(func.count())
        .select_from(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            or_(Conversation.guest_id == user.id, Conversation.host_id == user.id),
            Message.sender_id != user.id,
            Message.read_at.is_(None),
        )
    )
    return {"count": count or 0}


@router.post("", response_model=schemas.ConversationDetail)
def start_conversation(payload: schemas.ConversationIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Get-or-create the thread for this listing (one per guest + listing, like Airbnb)."""
    kind = payload.listing_type
    if payload.reservation_id is not None:
        r = _reservation(db, kind, payload.reservation_id)
        if r is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Reservation not found")
        listing_id = _reservation_listing_id(kind, r)
        if payload.listing_id is not None and payload.listing_id != listing_id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That reservation is for a different listing")
        item = _listing(db, kind, listing_id)
        if item is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
        if user.id not in (r.guest_id, item.host_id):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Reservation not found")
        guest_id, reservation_id = r.guest_id, r.id
    else:
        item = _listing(db, kind, payload.listing_id)
        if item is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Listing not found")
        if item.host_id == user.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't message yourself about your own listing")
        guest_id = user.id
        reservation_id = _latest_reservation_id(db, kind, item.id, guest_id)

    c = db.scalar(
        select(Conversation).where(
            Conversation.guest_id == guest_id,
            Conversation.host_id == item.host_id,
            Conversation.listing_type == kind,
            Conversation.listing_id == item.id,
        )
    )
    if c is None:
        c = Conversation(guest_id=guest_id, host_id=item.host_id, listing_type=kind, listing_id=item.id,
                         reservation_id=reservation_id)
        db.add(c)
        db.commit()
    elif payload.reservation_id is not None or (c.reservation_id is None and reservation_id is not None):
        # opened from a specific trip: the context drawer follows that trip
        c.reservation_id = reservation_id
        db.commit()
    return get_conversation(c.id, db, user)


@router.get("/{conversation_id}", response_model=schemas.ConversationDetail)
def get_conversation(conversation_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = _owned(db, conversation_id, user)
    messages = db.scalars(select(Message).where(Message.conversation_id == c.id).order_by(Message.id)).all()
    unread = _unread_counts(db, user, [c.id]).get(c.id, 0)
    s = _summary(db, c, user, messages[-1] if messages else None, unread)
    reservation = s.pop("_reservation")
    return {**s, "reservation": _reservation_out(reservation), "messages": messages}


@router.post("/{conversation_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(conversation_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    c = _owned(db, conversation_id, user)
    db.execute(
        update(Message)
        .where(Message.conversation_id == c.id, Message.sender_id != user.id, Message.read_at.is_(None))
        .values(read_at=datetime.now())
    )
    db.commit()


@router.post("/{conversation_id}/messages", response_model=schemas.MessageOut, status_code=201)
def send_message(
    conversation_id: int, payload: schemas.MessageIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    c = _owned(db, conversation_id, user)
    # raises ContactInfoProhibited (-> 422 CONTACT_INFO_PROHIBITED) for obvious contact info
    result = sanitize_and_validate_message(payload.content)
    if not result.content:  # only invisible characters
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Message can't be empty")
    now = datetime.now()
    message = Message(
        conversation_id=c.id,
        sender_id=user.id,
        sender_role=_role(c, user),
        raw_attempted_flag=result.redacted,
        content=result.content,
        is_blocked=result.is_blocked,
        moderation_warning=result.warning,
        created_at=now,
    )
    db.add(message)
    c.updated_at = now
    db.commit()
    db.refresh(message)
    return message
