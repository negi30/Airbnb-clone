import re

with open("README.md", "r") as f:
    content = f.read()

new_section = """## Database Workflow & Schema

The application uses **SQLite** by default, with an automated initialization, seeding, and migration workflow built directly into the FastAPI application lifecycle, bypassing the need for an external migration tool like Alembic for simple deployments.

### Startup Lifecycle (Initialization & Seeding)

1. **Lifespan Context Manager**: Inside `backend/app/main.py`, the FastAPI app is wrapped in an `asynccontextmanager` called `lifespan`. This ensures the database is initialized (`init_db()`) before the application starts accepting HTTP requests.
2. **Schema Creation**: `Base.metadata.create_all(engine)` evaluates `backend/app/models.py` and creates all tables if they don't exist.
3. **Automated Migrations**: The `init_db()` function calls `migrate()` (in `backend/app/seed.py`). This uses SQLAlchemy's `inspect` to check if certain columns (like `cancelled_by` and `cancelled_at`) exist. If they don't, it executes raw `ALTER TABLE` DDLs. This guarantees older SQLite files are upgraded seamlessly without Alembic.
4. **Isolated Seeding**: If the database is empty, it sequentially runs three seeding scripts:
   - `seed()`: 15 users (hosts/guests), ~50 listings, listing amenities, listing photos, and ~400 bookings (past, present, and cancelled).
   - `seed_experiences()`: Experiences, services, slots, and experience bookings.
   - `seed_messages()`: Threads containing sanitized and Trust & Safety-flagged messages.
5. **Foreign Key Enforcement**: Since SQLite disables foreign keys by default, `backend/app/database.py` binds a `@event.listens_for(Engine, "connect")` hook to execute `PRAGMA foreign_keys=ON;` on every new database connection.

### Entity Relationship Diagram

```mermaid
erDiagram
    users ||--o{ listings : hosts
    users ||--o{ bookings : makes
    users ||--o{ reviews : writes
    users ||--o{ wishlist_items : saves
    listings ||--o{ listing_photos : has
    listings }o--o{ amenities : "listing_amenities"
    listings ||--o{ bookings : receives
    listings ||--o{ reviews : receives
    listings ||--o{ wishlist_items : "saved in"
    bookings ||--o| reviews : "reviewed by"
    users ||--o{ conversations : "guest / host"
    conversations ||--o{ messages : contains
    users ||--o{ experiences : hosts
    experiences ||--o{ experience_slots : has
    experience_slots ||--o{ experience_bookings : receives
```

### Table Overview

| Table | Key columns | Notes |
|---|---|---|
| `users` | id, name, email (unique), avatar_url, bio, is_host, is_superhost, created_at | One table for guests and hosts. A host can also travel as a guest. |
| `listings` | id, **host_id → users**, title, property_type, category, city, latitude, longitude, price_per_night, cleaning_fee, max_guests, bedrooms, beds, bathrooms | `CHECK price > 0`, `CHECK max_guests > 0`. Indexed on `host_id`, `city`, and `category`. |
| `listing_photos` | id, **listing_id → listings**, url, position | Ordered gallery; position 0 is the cover. Cascade delete. |
| `amenities` | id, name (unique), icon | Lookup table. |
| `listing_amenities` | **listing_id, amenity_id** (composite PK) | Many-to-many join table connecting `listings` to `amenities`. |
| `bookings` | id, **listing_id**, **guest_id**, check_in, check_out, guests, nightly_rate, nights, cleaning_fee, service_fee, taxes, total_price, status, cancelled_by, cancelled_at | `CHECK check_out > check_in`. Composite index `(listing_id, check_in, check_out)` for rapid overlap detection. |
| `reviews` | id, **listing_id**, **author_id**, **booking_id (unique)**, rating, comment | `CHECK rating BETWEEN 1 AND 5`. The unique `booking_id` enforces a strict one-review-per-stay constraint. |
| `wishlist_items` | id, **user_id**, **listing_id**, created_at | `UNIQUE(user_id, listing_id)`, so idempotent saves have no side effects. |
| `experiences` | id, **host_id**, kind, title, category, city, meeting_point, lat/lng, price_per_guest, duration_minutes, max_guests | One table for Experiences and Services (`kind` flag). `CHECK` constraints on kind, price, guests, and duration. |
| `experience_slots` | id, **experience_id**, starts_at, capacity | `UNIQUE(experience_id, starts_at)`. Remaining availability = `capacity - SUM(guests)`. |
| `experience_bookings` | id, **slot_id**, **guest_id**, guests, price snapshot, status, cancelled_by, cancelled_at | Soft cancellation mechanism preserves history and frees capacity immediately. |
| `conversations` | id, **guest_id**, **host_id**, listing_type, listing_id, reservation_id | Thread routing per entity. `listing_id` is an integer reference, allowing robust handling of deleted listings without FK errors. |
| `messages` | id, **conversation_id**, **sender_id**, sender_role, content, raw_attempted_flag, is_blocked, moderation_warning | Content is sanitized pre-insert. Fields like `raw_attempted_flag` denote Trust & Safety interventions. |

### Architectural Data Decisions

- **Half-open date ranges** `[check_in, check_out)`: Availability overlap logic checks if `a.check_in < b.check_out AND b.check_in < a.check_out`. This exact formulation allows a guest to check in on the same day the previous guest checks out, mirroring real-world hospitality rules.
- **Immutable Price Snapshots**: The nightly rate, fees, taxes, and total are computed by `services/pricing.py` and copied verbatim into the `bookings` row. If a host later modifies the listing price, historical and upcoming booking records are structurally isolated from the change.
- **Soft Deletion & Cancellations**: Handled via `status = 'cancelled'`, `cancelled_by`, and `cancelled_at`. `cancelled_by` is securely inferred server-side based on the authenticated `X-User-Id` invoking the endpoint. Availability queries strictly filter for `status = 'confirmed'`.
- **Derived, Aggregated Ratings**: Averages and review counts are never persisted as static columns on the `listings` table. They are dynamically derived using `GROUP BY` aggregates in `serializers.rating_stats` to completely eliminate data drift.
- **Protective Deletion Constraints**: The API actively blocks `DELETE /api/listings/{id}` with a `409 Conflict` if the listing holds any upcoming reservations. The host is forced to cancel reservations explicitly to prevent orphaned trips.
- **Trust & Safety Message Filter**: Handled by `app/services/moderation.py` before inserting into `messages`. Phone numbers, emails, links, or obscured patterns (like "nine eight seven" or Hinglish "ek do teen") return a `422` error or are masked with `[Hidden by Airbnb for safety]`.
"""

# Regex to match the section between ## Database schema and the next ---
pattern = r"## Database schema\n.*?(?=\n---\n\n## API overview)"
new_content = re.sub(pattern, new_section.strip(), content, flags=re.DOTALL)

with open("README.md", "w") as f:
    f.write(new_content)
