"""Host dashboard: experience/service CRUD and host- vs guest-initiated cancellation."""
import os
from datetime import date, timedelta

os.environ.setdefault("DATABASE_URL", "sqlite:///./test.db")

import pytest
from fastapi.testclient import TestClient

from app.database import engine
from app.main import app
from app.seed import init_db


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
    return {"priya": {"X-User-Id": str(by_name["Priya"])}, "aarav": {"X-User-Id": str(by_name["Aarav"])},
            "daniel": {"X-User-Id": str(by_name["Daniel"])}}


PAYLOAD = {
    "kind": "service", "title": "Sunset portrait session", "tagline": "Golden-hour portraits on the beach.",
    "description": "A relaxed hour of portraits with 30 edited photos delivered the next day.",
    "category": "Photography", "host_title": "Photographer", "city": "Goa", "state": "Goa", "country": "India",
    "meeting_point": "Baga Beach", "address": "Baga, Goa", "latitude": 15.55, "longitude": 73.75,
    "price_per_guest": 4000, "duration_minutes": 60, "max_guests": 4, "included": "30 edited photos",
    "photo_urls": ["https://example.com/a.jpg"],
    "activities": [{"title": "Portraits", "description": "One location, many looks."}],
    "start_times": ["17:00", "07:00"], "schedule_days": 7,
}


def test_priya_hosts_experiences_and_services(client, ids):
    kinds = {e["kind"] for e in client.get("/api/host/experiences", headers=ids["priya"]).json()}
    assert kinds == {"experience", "service"}


def test_create_edit_delete_service(client, ids):
    res = client.post("/api/experiences", json=PAYLOAD, headers=ids["priya"])
    assert res.status_code == 201, res.text
    exp_id = res.json()["id"]
    slots = client.get(f"/api/experiences/{exp_id}/slots?days=8").json()
    assert 12 <= len(slots) <= 14 and {s["starts_at"][11:16] for s in slots} == {"07:00", "17:00"}

    form = client.get(f"/api/host/experiences/{exp_id}", headers=ids["priya"]).json()
    assert form["start_times"] == ["07:00", "17:00"]
    # another host can't edit it, and kind can't flip
    assert client.put(f"/api/experiences/{exp_id}", json=PAYLOAD, headers=ids["daniel"]).status_code == 403
    assert client.put(f"/api/experiences/{exp_id}", json={**PAYLOAD, "kind": "experience", "category": "Cooking"},
                      headers=ids["priya"]).status_code == 422

    # a booked slot survives dropping its start time; unbooked ones go
    booked = next(s for s in slots if s["starts_at"][11:16] == "07:00")
    assert client.post("/api/experience-bookings", json={"slot_id": booked["id"], "guests": 1},
                       headers=ids["aarav"]).status_code == 201
    res = client.put(f"/api/experiences/{exp_id}", json={**PAYLOAD, "start_times": ["17:00"]}, headers=ids["priya"])
    assert res.status_code == 200
    times = [s["starts_at"] for s in client.get(f"/api/experiences/{exp_id}/slots?days=8").json()]
    assert booked["starts_at"] in times and sum(t[11:16] == "07:00" for t in times) == 1

    # can't delete with an upcoming booking
    assert client.delete(f"/api/experiences/{exp_id}", headers=ids["priya"]).status_code == 409
    bookings = client.get("/api/host/experience-bookings", headers=ids["priya"]).json()
    mine = next(b for b in bookings if b["experience"]["id"] == exp_id)
    client.patch(f"/api/host/reservations/service/{mine['id']}/cancel", headers=ids["priya"])
    assert client.delete(f"/api/experiences/{exp_id}", headers=ids["priya"]).status_code == 204
    assert client.get(f"/api/experiences/{exp_id}").status_code == 404


def test_category_must_match_kind(client, ids):
    res = client.post("/api/experiences", json={**PAYLOAD, "category": "Cooking"}, headers=ids["priya"])
    assert res.status_code == 422


def _new_stay(client, ids, offset):
    listing = client.get("/api/host/listings", headers=ids["priya"]).json()[0]
    check_in = date.today() + timedelta(days=offset)
    res = client.post("/api/bookings", headers=ids["aarav"], json={
        "listing_id": listing["id"], "check_in": str(check_in), "check_out": str(check_in + timedelta(days=2)), "guests": 1,
    })
    assert res.status_code == 201, res.text
    return res.json()


def test_host_cancellation_is_flagged_for_guest(client, ids):
    stay = _new_stay(client, ids, 200)
    # a guest can't pose as the host
    assert client.patch(f"/api/host/reservations/home/{stay['id']}/cancel", headers=ids["aarav"]).status_code == 403
    # another host can't cancel it either
    assert client.patch(f"/api/host/reservations/home/{stay['id']}/cancel", headers=ids["daniel"]).status_code == 404
    res = client.patch(f"/api/host/reservations/home/{stay['id']}/cancel", headers=ids["priya"])
    assert res.status_code == 200 and res.json()["cancelled_by"] == "host" and res.json()["cancelled_at"]
    trip = next(t for t in client.get("/api/bookings/me", headers=ids["aarav"]).json() if t["id"] == stay["id"])
    assert trip["status"] == "cancelled" and trip["cancelled_by"] == "host"
    # cancelled stays don't count toward host earnings
    reservations = client.get("/api/host/bookings", headers=ids["priya"]).json()
    assert next(b for b in reservations if b["id"] == stay["id"])["status"] == "cancelled"


def test_guest_cancellation_is_flagged_as_guest(client, ids):
    stay = _new_stay(client, ids, 220)
    res = client.post(f"/api/bookings/{stay['id']}/cancel", headers=ids["aarav"])
    assert res.json()["cancelled_by"] == "guest"


def test_seed_has_host_cancelled_demo(client, ids):
    stays = client.get("/api/bookings/me", headers=ids["aarav"]).json()
    exps = client.get("/api/experience-bookings/me", headers=ids["aarav"]).json()
    assert any(b["cancelled_by"] == "host" for b in stays)
    assert any(b["cancelled_by"] == "host" for b in exps)


def test_host_cancel_checks_the_kind_in_the_url(client, ids):
    from datetime import datetime

    priya = ids["priya"]
    rows = client.get("/api/host/experience-bookings", headers=priya).json()
    row = next(b for b in rows if b["status"] == "confirmed" and b["slot"]["starts_at"] > datetime.now().isoformat())
    wrong = "service" if row["experience"]["kind"] == "experience" else "experience"
    assert client.patch(f"/api/host/reservations/{wrong}/{row['id']}/cancel", headers=priya).status_code == 404
