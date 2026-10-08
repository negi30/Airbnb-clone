"""Seed guest <-> host conversations, built on bookings that already exist.

Every message goes through the same Trust & Safety filter as the API (`moderate`), so
the demo threads include real redactions: a phone number spelled out in words, an
obfuscated email, a WhatsApp nudge and a UPI id.
"""
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Booking, Conversation, Experience, ExperienceBooking, ExperienceSlot, Listing, Message, User
from .services.moderation import moderate

# (sender, text, hours ago, read by the recipient?)
Line = tuple[str, str, float, bool]


def _user(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


def _stay(db: Session, guest: User, host: User | None = None, status: str = "confirmed", upcoming: bool = True) -> Booking | None:
    q = select(Booking).join(Listing).where(Booking.guest_id == guest.id, Booking.status == status)
    if host is not None:
        q = q.where(Listing.host_id == host.id)
    today = datetime.now().date()
    q = q.where(Booking.check_in > today) if upcoming else q
    return db.scalar(q.order_by(Booking.check_in).limit(1))


def _slot_booking(db: Session, guest: User, host: User | None = None, status: str = "confirmed") -> ExperienceBooking | None:
    q = (
        select(ExperienceBooking)
        .join(ExperienceSlot, ExperienceSlot.id == ExperienceBooking.slot_id)
        .join(Experience, Experience.id == ExperienceSlot.experience_id)
        .where(ExperienceBooking.guest_id == guest.id, ExperienceBooking.status == status)
    )
    if host is not None:
        q = q.where(Experience.host_id == host.id)
    return db.scalar(q.order_by(ExperienceSlot.starts_at.desc()).limit(1))


def _thread(db: Session, guest: User, host: User, kind: str, listing_id: int, reservation_id: int | None,
            lines: list[Line]) -> None:
    exists = db.scalar(
        select(Conversation.id).where(
            Conversation.guest_id == guest.id, Conversation.host_id == host.id,
            Conversation.listing_type == kind, Conversation.listing_id == listing_id,
        )
    )
    if exists:
        return
    now = datetime.now()
    c = Conversation(guest_id=guest.id, host_id=host.id, listing_type=kind, listing_id=listing_id,
                     reservation_id=reservation_id, created_at=now - timedelta(hours=lines[0][2]))
    for sender, text, hours_ago, read in lines:
        at = now - timedelta(hours=hours_ago)
        m = moderate(text)
        c.messages.append(Message(
            sender_id=guest.id if sender == "guest" else host.id, sender_role=sender,
            content=m.content, raw_attempted_flag=m.redacted, is_blocked=m.is_blocked,
            moderation_warning=m.warning, created_at=at, read_at=at + timedelta(minutes=20) if read else None,
        ))
    c.updated_at = now - timedelta(hours=lines[-1][2])
    db.add(c)


def seed_messages(db: Session) -> None:
    aarav, sofia, kabir = (_user(db, f"{n}@example.com") for n in ("aarav", "sofia", "kabir"))
    priya, leo, daniel = (_user(db, f"{n}@example.com") for n in ("priya", "leo", "daniel"))
    if not all((aarav, sofia, kabir, priya, leo, daniel)):
        return

    # 1. Aarav's next stay: a phone number spelled out in words gets hidden
    stay = _stay(db, aarav)
    if stay:
        host = stay.listing.host
        first = host.name.split()[0]
        _thread(db, aarav, host, "home", stay.listing_id, stay.id, [
            ("guest", f"Hi {first}! We're really looking forward to the trip. Is an early check-in possible?", 70, True),
            ("host", "Hi Aarav, welcome! Early check-in usually works if the previous guests leave on time. "
                     "I'll confirm the day before you arrive.", 69, True),
            ("guest", "Perfect. My number is nine eight seven six five four three two one zero, just call me when you know.", 50, True),
            ("host", "Thanks! I'll message you right here on Airbnb so everything stays in one place.", 49, True),
            ("host", "Good news: the place will be ready by noon on your check-in day. Safe travels!", 5, False),
        ])

    # 2. Priya cancelled Aarav's private chef dinner: the guest follows up on the cancelled trip
    chef = _slot_booking(db, aarav, priya, status="cancelled")
    if chef:
        exp = chef.slot.experience
        _thread(db, aarav, priya, exp.kind, exp.id, chef.id, [
            ("host", "Hi Aarav, I'm so sorry, but I had to cancel your dinner because of a family emergency. "
                     "Your full refund is already on its way.", 30, True),
            ("guest", "No worries at all, I hope everything is okay. Could we rebook for later this month?", 28, True),
            ("host", "Of course. New evenings open up from next week; book whichever suits you and I'll plan the menu around it.", 27, True),
            ("guest", "Great, I'll pick one this weekend. Thanks Priya!", 26, True),
        ])

    # 3. Aarav's inquiry to Leo before booking: no reservation, and a WhatsApp nudge gets hidden
    leo_exp = db.scalar(select(Experience).where(Experience.host_id == leo.id, Experience.kind == "experience").limit(1))
    if leo_exp:
        _thread(db, aarav, leo, "experience", leo_exp.id, None, [
            ("guest", "Hello! Is this suitable for vegetarians? My partner doesn't eat meat or fish.", 20, True),
            ("host", "Absolutely, every dish has a vegetarian version and I'll plan for it as soon as you book.", 18, True),
            ("guest", "Lovely. Could you send the menu on whatsapp?", 17, True),
            ("host", "I'll share the full menu here once you've booked. That keeps your payment protected.", 16, False),
        ])

    # 4. Sofia and Priya: an obfuscated email plus a request to pay off-platform
    priya_exp = db.scalar(select(Experience).where(Experience.host_id == priya.id, Experience.kind == "experience").limit(1))
    if priya_exp:
        booking = _slot_booking(db, sofia, priya)
        target = booking.slot.experience if booking else priya_exp
        _thread(db, sofia, priya, target.kind, target.id, booking.id if booking else None, [
            ("guest", "Hi Priya! Can my sister join too? There would be two of us.", 12, True),
            ("host", "Hi Sofia, of course! Just update the guest count on your booking and you're both set.", 11, True),
            ("guest", "Thank you! Could I pay you directly instead? My email is sofia at gmail dot com, or I can send it to priya@okaxis",
             3, False),
        ])

    # 5. Kabir asks Priya about a stay: unread for the host
    kabir_stay = _stay(db, kabir, priya) or _stay(db, kabir, priya, upcoming=False)
    listing = kabir_stay.listing if kabir_stay else db.scalar(select(Listing).where(Listing.host_id == priya.id).limit(1))
    if listing:
        _thread(db, kabir, priya, "home", listing.id, kabir_stay.id if kabir_stay else None, [
            ("guest", "Hi Priya, how reliable is the wifi? I'll be working remotely for most of the stay.", 2, False),
        ])

    # 6. Daniel and a guest of one of his homes
    daniel_listing_ids = select(Listing.id).where(Listing.host_id == daniel.id)
    guest_stay = db.scalar(
        select(Booking).where(Booking.listing_id.in_(daniel_listing_ids), Booking.status == "confirmed",
                              Booking.check_in > datetime.now().date()).order_by(Booking.check_in).limit(1)
    )
    if guest_stay:
        guest = guest_stay.guest
        _thread(db, guest, daniel, "home", guest_stay.listing_id, guest_stay.id, [
            ("guest", "Hi Daniel, is there parking close to the house?", 40, True),
            ("host", f"Hi {guest.name.split()[0]}, yes: there's a free spot right by the gate. "
                     "I'll leave directions in the check-in guide.", 39, True),
            ("guest", "Brilliant, thanks!", 38, True),
        ])
    db.commit()
