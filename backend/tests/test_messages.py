"""Messaging: threads, read state and the Trust & Safety filter."""
import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test.db")

import pytest
from fastapi.testclient import TestClient

from app.database import engine
from app.main import app
from app.seed import init_db
from app.services.moderation import PLACEHOLDER, ContactInfoProhibited, moderate, sanitize_and_validate_message


@pytest.fixture(scope="module")
def client():
    engine.dispose()
    init_db(reset=True)
    with TestClient(app) as c:
        yield c
    engine.dispose()
    if os.path.exists("test.db"):
        os.remove("test.db")


@pytest.fixture(scope="module")
def ids(client):
    users = client.get("/api/users").json()
    by_name = {u["name"].split()[0]: u["id"] for u in users}
    return {n.lower(): {"X-User-Id": str(by_name[n])} for n in ("Priya", "Aarav", "Daniel", "Sofia", "Kabir")}


# ------------------------------------------------------------------ filter
@pytest.mark.parametrize("text", [
    "+91 98765-43210", "(555) 123 4567", "call 9 8 7 6", "mail me at a@b.com", "see www.example.com", "check-in at 3pm",
])
def test_obvious_contact_info_is_hard_blocked(text):
    with pytest.raises(ContactInfoProhibited):
        sanitize_and_validate_message(text)


@pytest.mark.parametrize("text", [
    "nine eight seven six five four three two one zero",
    "double nine triple four",
    "ek do teen char paanch",
    "９８７６５４３２１０",  # fullwidth digits
    "٩٨٧٦",  # Arabic-Indic digits
    "priya at gmail dot com",
    "pay priya@okaxis",
    "find me on w h a t s a p p",
    "my insta is @priya.travels",
    "text me later",
    "ninety eight seventy six fifty four",
    "priya (at) yahoo (dot) in",
])
def test_obfuscated_contact_info_is_redacted(text):
    m = sanitize_and_validate_message(text)
    assert m.redacted and PLACEHOLDER in m.content and m.warning
    assert not any(c.isdigit() for c in m.content)


@pytest.mark.parametrize("text", [
    "Hi! Is the cabin available next weekend?",
    "Can someone help? This one looks great.",
    "Do you have a double room with two beds?",
    "The wifi signal is weak upstairs",
    "Message me here if you need anything",
    "Is check-in flexible?",
    "Arrive at noon. Thanks",  # "at ... . Thanks" is not an email
    "Let's look at this. Thanks!",
    "Hi.Me and my wife will arrive late",  # a missing space is not a ".me" link
    "Checked.In the morning we leave",
    "Twenty minutes from the station",
    "Room for twenty five guests?",
])
def test_ordinary_messages_pass_untouched(text):
    m = sanitize_and_validate_message(text)
    assert not m.redacted and m.content == text and m.warning is None


def test_zero_width_characters_are_stripped():
    assert moderate("he​llo").content == "hello"
    assert moderate("w​hatsapp").redacted


def test_message_that_is_only_contact_info_is_blocked():
    m = moderate("nine eight seven six five")
    assert m.is_blocked and m.content == PLACEHOLDER


# ------------------------------------------------------------------ API
def _trip(client, who):
    trips = client.get("/api/bookings/me", headers=who).json()
    return next(t for t in trips if t["status"] == "confirmed")


def test_guest_inquiry_then_host_reply_and_read_state(client, ids):
    listing = client.get("/api/listings?page_size=50").json()["items"]
    target = next(l for l in listing if l["host_name"].startswith("Daniel"))
    r = client.post("/api/conversations", json={"listing_type": "home", "listing_id": target["id"]}, headers=ids["kabir"])
    assert r.status_code == 200
    thread = r.json()
    assert thread["role"] == "guest" and thread["counterpart"]["name"].startswith("Daniel")
    # opening again reuses the same thread
    again = client.post("/api/conversations", json={"listing_type": "home", "listing_id": target["id"]}, headers=ids["kabir"])
    assert again.json()["id"] == thread["id"]

    sent = client.post(f"/api/conversations/{thread['id']}/messages", json={"content": "Is the house pet friendly?"},
                       headers=ids["kabir"])
    assert sent.status_code == 201 and sent.json()["sender_role"] == "guest"

    before = client.get("/api/conversations/unread-count", headers=ids["daniel"]).json()["count"]
    inbox = client.get("/api/conversations?role=host", headers=ids["daniel"]).json()
    row = next(c for c in inbox if c["id"] == thread["id"])
    assert row["unread_count"] == 1 and row["last_message"]["content"] == "Is the house pet friendly?"

    assert client.post(f"/api/conversations/{thread['id']}/read", headers=ids["daniel"]).status_code == 204
    after = client.get("/api/conversations/unread-count", headers=ids["daniel"]).json()["count"]
    assert after == before - 1

    reply = client.post(f"/api/conversations/{thread['id']}/messages", json={"content": "Yes, pets are welcome!"},
                        headers=ids["daniel"])
    assert reply.json()["sender_role"] == "host"


def test_send_rejects_raw_digits_with_structured_422(client, ids):
    trip = _trip(client, ids["aarav"])
    thread = client.post("/api/conversations", json={"listing_type": "home", "reservation_id": trip["id"]},
                         headers=ids["aarav"]).json()
    r = client.post(f"/api/conversations/{thread['id']}/messages", json={"content": "call +91 98765 43210"},
                    headers=ids["aarav"])
    assert r.status_code == 422
    assert r.json()["code"] == "CONTACT_INFO_PROHIBITED"
    assert r.json()["message"] == "Numbers and contact details cannot be shared in messages."


def test_send_redacts_obfuscated_numbers_for_both_sides(client, ids):
    trip = _trip(client, ids["aarav"])
    thread = client.post("/api/conversations", json={"listing_type": "home", "reservation_id": trip["id"]},
                         headers=ids["aarav"]).json()
    assert thread["reservation"]["id"] == trip["id"] and thread["status"] in ("upcoming", "in_progress", "completed")
    r = client.post(f"/api/conversations/{thread['id']}/messages",
                    json={"content": "my number is nine eight seven six five four"}, headers=ids["aarav"])
    body = r.json()
    assert r.status_code == 201 and body["raw_attempted_flag"] and body["moderation_warning"]
    assert body["content"] == f"my number is {PLACEHOLDER}"
    host = client.get(f"/api/listings/{trip['listing']['id']}").json()["host"]
    seen = client.get(f"/api/conversations/{thread['id']}", headers={"X-User-Id": str(host["id"])}).json()
    assert seen["role"] == "host" and seen["messages"][-1]["content"] == body["content"]


def test_host_can_message_guest_from_a_reservation(client, ids):
    stays = client.get("/api/host/bookings", headers=ids["priya"]).json()
    stay = next(b for b in stays if b["status"] == "confirmed")
    r = client.post("/api/conversations", json={"listing_type": "home", "reservation_id": stay["id"]}, headers=ids["priya"])
    assert r.status_code == 200
    thread = r.json()
    assert thread["role"] == "host" and thread["counterpart"]["id"] == stay["guest"]["id"]


def test_threads_are_private(client, ids):
    trip = _trip(client, ids["aarav"])
    thread = client.post("/api/conversations", json={"listing_type": "home", "reservation_id": trip["id"]},
                         headers=ids["aarav"]).json()
    assert client.get(f"/api/conversations/{thread['id']}", headers=ids["sofia"]).status_code == 404
    assert client.post(f"/api/conversations/{thread['id']}/messages", json={"content": "hi"},
                       headers=ids["sofia"]).status_code == 404
    # someone else's reservation can't be used to open a thread
    assert client.post("/api/conversations", json={"listing_type": "home", "reservation_id": trip["id"]},
                       headers=ids["sofia"]).status_code == 404


def test_hosts_cannot_inquire_about_their_own_listing(client, ids):
    mine = client.get("/api/host/listings", headers=ids["priya"]).json()[0]
    r = client.post("/api/conversations", json={"listing_type": "home", "listing_id": mine["id"]}, headers=ids["priya"])
    assert r.status_code == 400


def test_kind_must_match_the_experience(client, ids):
    services = client.get("/api/experiences?kind=service&page_size=1").json()["items"]
    r = client.post("/api/conversations", json={"listing_type": "experience", "listing_id": services[0]["id"]},
                    headers=ids["aarav"])
    assert r.status_code == 404


def test_seed_threads_showcase_redaction(client, ids):
    inbox = client.get("/api/conversations", headers=ids["aarav"]).json()
    assert len(inbox) >= 3
    assert {"cancelled_by_host", "inquiry"} <= {c["status"] for c in inbox}
    messages = [m for c in inbox for m in client.get(f"/api/conversations/{c['id']}", headers=ids["aarav"]).json()["messages"]]
    assert any(m["raw_attempted_flag"] and PLACEHOLDER in m["content"] for m in messages)
    assert all(not any(ch.isdigit() for ch in m["content"]) for m in messages)
