"""Experiences & services: slot capacity, booking, reviews. Run from backend/:  pytest -q"""
import os
from datetime import datetime

os.environ.setdefault("DATABASE_URL", "sqlite:///./test.db")

import pytest
from fastapi.testclient import TestClient

from app.database import engine
from app.main import app
from app.seed import init_db


@pytest.fixture(scope="module")
def client():
    engine.dispose()  # another test module may have deleted the file under a pooled connection
    init_db(reset=True)
    with TestClient(app) as c:
        yield c
    engine.dispose()
    if os.path.exists("test.db"):
        os.remove("test.db")


@pytest.fixture(scope="module")
def guest(client):
    aarav = next(u for u in client.get("/api/users").json() if u["name"].startswith("Aarav"))
    return {"X-User-Id": str(aarav["id"])}


def open_slot(client, experience_id=1, guests=1):
    return client.get(f"/api/experiences/{experience_id}/slots?guests={guests}").json()[-1]


def test_search_splits_kinds(client):
    exps = client.get("/api/experiences?kind=experience&page_size=50").json()["items"]
    svcs = client.get("/api/experiences?kind=service&page_size=50").json()["items"]
    assert exps and svcs
    assert {e["kind"] for e in exps} == {"experience"} and {s["kind"] for s in svcs} == {"service"}


def test_date_window_only_returns_bookable_slots(client):
    slot = open_slot(client)
    day = slot["starts_at"][:10]
    items = client.get(f"/api/experiences?date_from={day}&date_to={day}&page_size=50").json()["items"]
    assert items and all(i["next_slot"][:10] == day for i in items)


def test_booking_respects_capacity(client, guest):
    slot = open_slot(client)
    too_many = slot["spots_left"] + 1
    res = client.post("/api/experience-bookings", json={"slot_id": slot["id"], "guests": too_many}, headers=guest)
    assert res.status_code in (409, 422)
    ok = client.post("/api/experience-bookings", json={"slot_id": slot["id"], "guests": 2}, headers=guest)
    assert ok.status_code == 201
    left = next(s for s in client.get("/api/experiences/1/slots").json() if s["id"] == slot["id"])["spots_left"]
    assert left == slot["spots_left"] - 2


def test_quote_matches_booking_total(client, guest):
    q = client.get("/api/experiences/2/quote?guests=3").json()
    b = client.post("/api/experience-bookings", json={"slot_id": open_slot(client, 2, 3)["id"], "guests": 3}, headers=guest).json()
    assert q["total"] == b["total_price"]


def test_cancel_frees_spots(client, guest):
    slot = open_slot(client, 4)
    b = client.post("/api/experience-bookings", json={"slot_id": slot["id"], "guests": 1}, headers=guest).json()
    assert client.post(f"/api/experience-bookings/{b['id']}/cancel", headers=guest).status_code == 200
    after = next(s for s in client.get("/api/experiences/4/slots").json() if s["id"] == slot["id"])
    assert after["spots_left"] == slot["spots_left"]


def test_host_cannot_book_own_experience(client):
    detail = client.get("/api/experiences/1").json()
    host = {"X-User-Id": str(detail["host"]["id"])}
    res = client.post("/api/experience-bookings", json={"slot_id": open_slot(client)["id"], "guests": 1}, headers=host)
    assert res.status_code == 400


def test_review_only_after_completion(client, guest):
    now = datetime.now().isoformat()
    mine = [b for b in client.get("/api/experience-bookings/me", headers=guest).json() if b["status"] == "confirmed"]
    upcoming = next(b for b in mine if b["slot"]["starts_at"] > now)
    done = next(b for b in mine if b["slot"]["ends_at"] < now and not b["has_review"])

    def review(b):
        body = {"booking_id": b["id"], "rating": 5, "comment": "Lovely time!"}
        return client.post(f"/api/experiences/{b['experience']['id']}/reviews", json=body, headers=guest).status_code

    assert review(upcoming) == 400
    assert review(done) == 201
    assert review(done) == 409


def test_save_is_idempotent(client, guest):
    assert client.put("/api/experiences/5/save", headers=guest).status_code == 204
    assert client.put("/api/experiences/5/save", headers=guest).status_code == 204
    assert client.get("/api/experiences/saved/ids", headers=guest).json().count(5) == 1
    assert client.delete("/api/experiences/5/save", headers=guest).status_code == 204
    assert 5 not in client.get("/api/experiences/saved/ids", headers=guest).json()
