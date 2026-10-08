"""API tests for the booking rules. Run from backend/:  pytest -q"""
import os
from datetime import date, timedelta

os.environ["DATABASE_URL"] = "sqlite:///./test.db"

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.seed import init_db

GUEST = {"X-User-Id": "8"}  # Aarav (seeded guest; ids 1-7 are hosts)
HOST = {"X-User-Id": "1"}  # Priya (seeded host)


@pytest.fixture(scope="module")
def client():
    init_db(reset=True)
    with TestClient(app) as c:
        yield c
    os.remove("test.db")


def far(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


def book(client, check_in, check_out, listing_id=2, headers=GUEST):
    return client.post(
        "/api/bookings",
        json={"listing_id": listing_id, "check_in": check_in, "check_out": check_out, "guests": 1},
        headers=headers,
    )


def test_booking_blocks_overlapping_dates(client):
    assert book(client, far(200), far(203)).status_code == 201
    # overlaps the last night
    assert book(client, far(202), far(205)).status_code == 409
    # fully inside
    assert book(client, far(201), far(202)).status_code == 409


def test_same_day_turnover_is_allowed(client):
    # previous stay checks out on far(203); a new stay may check in that day
    assert book(client, far(203), far(205)).status_code == 201


def test_invalid_ranges_rejected(client):
    assert book(client, far(10), far(10)).status_code == 422  # zero nights
    assert book(client, far(-5), far(-2)).status_code == 422  # in the past


def test_search_excludes_unavailable_listings(client):
    res = client.get(f"/api/listings?check_in={far(200)}&check_out={far(203)}&page_size=50").json()
    assert 2 not in [item["id"] for item in res["items"]]


def test_cancel_frees_dates(client):
    b = book(client, far(300), far(302)).json()
    assert client.post(f"/api/bookings/{b['id']}/cancel", headers=GUEST).status_code == 200
    assert book(client, far(300), far(302)).status_code == 201


def test_host_cannot_book_own_listing(client):
    own = client.get("/api/host/listings", headers=HOST).json()[0]["id"]
    assert book(client, far(400), far(401), listing_id=own, headers=HOST).status_code == 400


def test_guest_cannot_create_listing(client):
    assert client.post("/api/listings", json={}, headers=GUEST).status_code == 403


def test_quote_matches_booking_total(client):
    q = client.get(f"/api/listings/3/quote?check_in={far(500)}&check_out={far(504)}&guests=2").json()
    b = book(client, far(500), far(504), listing_id=3).json()
    assert q["total"] == b["total_price"] and q["nights"] == 4


def test_quote_refuses_dates_the_booking_would_refuse(client):
    past = (date.today() - timedelta(days=3)).isoformat()
    assert client.get(f"/api/listings/2/quote?check_in={past}&check_out={far(2)}").status_code == 422
    assert client.get(f"/api/listings/2/quote?check_in={far(10)}&check_out={far(110)}").status_code == 422
    assert client.get(f"/api/listings/2/quote?check_in={far(10)}&check_out={far(12)}").status_code == 200


def test_concurrent_bookings_cannot_double_book(client):
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(8) as pool:
        codes = list(pool.map(lambda _: book(client, far(500), far(503)).status_code, range(8)))
    assert codes.count(201) == 1 and codes.count(409) == 7


def test_seed_has_no_double_bookings_or_overbooked_slots(client):
    from sqlalchemy import text

    from app.database import engine

    with engine.connect() as conn:
        overlaps = conn.execute(text(
            "SELECT count(*) FROM bookings a JOIN bookings b ON a.listing_id = b.listing_id AND a.id < b.id "
            "WHERE a.status = 'confirmed' AND b.status = 'confirmed' "
            "AND a.check_in < b.check_out AND b.check_in < a.check_out"
        )).scalar()
        overbooked = conn.execute(text(
            "SELECT count(*) FROM (SELECT s.id FROM experience_slots s JOIN experience_bookings eb "
            "ON eb.slot_id = s.id AND eb.status = 'confirmed' GROUP BY s.id HAVING sum(eb.guests) > s.capacity)"
        )).scalar()
    assert overlaps == 0 and overbooked == 0


def test_blank_text_does_not_pass_length_rules(client):
    trips = client.get("/api/bookings/me", headers=GUEST).json()
    done = next(t for t in trips if t["status"] == "confirmed" and t["check_out"] < date.today().isoformat() and not t["has_review"])
    r = client.post(f"/api/listings/{done['listing']['id']}/reviews",
                    json={"booking_id": done["id"], "rating": 5, "comment": "  ok         "}, headers=GUEST)
    assert r.status_code == 422


def test_listing_category_must_be_a_known_one(client):
    listing = client.get("/api/listings/1").json()
    payload = {
        "title": "A perfectly fine title", "description": "A long enough description for the form.",
        "property_type": "House", "category": "Not a category", "city": "Goa", "country": "India",
        "latitude": 15, "longitude": 74, "price_per_night": 4000, "max_guests": 2, "bedrooms": 1, "beds": 1,
        "bathrooms": 1, "photo_urls": ["https://example.com/a.jpg"],
    }
    assert client.put(f"/api/listings/{listing['id']}", json=payload, headers=HOST).status_code == 422
