"""Seed the database with hosts, guests, ~50 listings, bookings and reviews.

Dates are generated relative to *today*, so the demo always has upcoming trips,
past stays and blocked calendar dates.

Run manually:  python -m app.seed --reset
"""
import random
import sys
from datetime import date, datetime, timedelta

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, engine
from .models import Amenity, Booking, Conversation, Experience, Listing, ListingPhoto, Review, User
from .seed_experiences import seed_experiences
from .seed_messages import seed_messages
from .services.pricing import calculate_price

U = "https://images.unsplash.com/photo-{}?auto=format&fit=crop&w=1200&q=80"

AMENITIES = [
    ("Wifi", "wifi"), ("Kitchen", "kitchen"), ("Free parking on premises", "parking"),
    ("Pool", "pool"), ("Air conditioning", "ac"), ("Washer", "washer"),
    ("Dedicated workspace", "workspace"), ("TV", "tv"), ("Hot tub", "hottub"),
    ("Indoor fireplace", "fireplace"), ("Beach access", "beach"), ("Mountain view", "mountain"),
    ("BBQ grill", "grill"), ("Gym", "gym"), ("Pets allowed", "pets"),
    ("Self check-in", "key"), ("Breakfast", "breakfast"), ("Heating", "heating"),
    ("Garden", "garden"), ("Smoke alarm", "alarm"), ("Lake access", "lake"), ("Ski-in/ski-out", "ski"),
]

HOSTS = [
    ("Priya Sharma", "priya@example.com", 47, True,
     "Architect turned host. I love restoring old homes and sharing them with travellers."),
    ("Rohan Kapoor", "rohan@example.com", 13, False,
     "Mountain person. I manage a few cabins in the Himalayas with my family."),
    ("Meera Iyer", "meera@example.com", 45, True,
     "Kerala-born, Bengaluru-based. Coffee, backwaters and good conversations."),
    ("Daniel Costa", "daniel@example.com", 15, False,
     "Travel photographer hosting homes I fell in love with around the world."),
    ("Ananya Rao", "ananya@example.com", 32, True,
     "Hospitality is our family business. Fast replies, spotless homes."),
    ("Leo Martinez", "leo@example.com", 65, True,
     "Chef and local guide. I host culinary experiences."),
    ("Nina Chen", "nina@example.com", 44, False,
     "Professional photographer and event planner."),
]
GUESTS = [
    ("Aarav Mehta", "aarav@example.com", 12),
    ("Sofia Fernandes", "sofia@example.com", 5),
    ("Kabir Singh", "kabir@example.com", 51),
    ("Ishita Verma", "ishita@example.com", 9),
    ("Liam Walker", "liam@example.com", 59),
    ("Zara Khan", "zara@example.com", 25),
    ("Arjun Nair", "arjun@example.com", 53),
    ("Emma Laurent", "emma@example.com", 44),
    ("Vikram Joshi", "vikram@example.com", 60),
    ("Noah Kim", "noah@example.com", 68),
]

COVERS = {
    "beach": ["1499793983690-e29da59ef1c2", "1507525428034-b723cf961d3e", "1519046904884-53103b34b206",
              "1512343879784-a960bf40e7f2"],
    "pool": ["1512917774080-9991f1c4c750", "1613490493576-7fde63acd811", "1600596542815-ffad4c1539a9",
             "1520250497591-112f2f40a3f4", "1566073771259-6a8506099945", "1571896349842-33c89424de2d"],
    "mountain": ["1449158743715-0a90ebb6d2d8", "1510798831971-661eb04b3739", "1542718610-a1d656d1884c",
                 "1470770841072-f978cf4d019e", "1501785888041-af3ef285b470", "1506905925346-21bda4d32df4"],
    "house": ["1564013799919-ab600027ffc6", "1600585154340-be6161a56a0c", "1580587771525-78b9dba3b914",
              "1570129477492-45c003edd2be", "1568605114967-8130f3a36994", "1518780664697-55e3ad937233",
              "1576941089067-2de3c901e126", "1583608205776-bfd35f0d9f83", "1600047509807-ba8f99d2cdde"],
    "city": ["1502672260266-1c1ef2d93688", "1522708323590-d24dbb6b0267", "1560448204-e02f11c3d0e2",
             "1493809842364-78817add7ffb", "1600607687939-ce8a6c25118c"],
    "tropical": ["1537996194471-e657df975ab4", "1540541338287-41700207dee6", "1514282401047-d79a71a590e8",
                 "1582719508461-905c673771fd"],
}
INTERIORS = [
    "1502672260266-1c1ef2d93688", "1522708323590-d24dbb6b0267", "1560448204-e02f11c3d0e2",
    "1493809842364-78817add7ffb", "1484154218962-a197022b5858", "1556909114-f6e7ad7d3136",
    "1556911220-bff31c812dba", "1540518614846-7eded433c457", "1505693416388-ac5ce068fe85",
    "1566665797739-1674de7a421a", "1595526114035-0d45ed16cfbf", "1631049307264-da0ec9d70304",
    "1552321554-5fefe8c9ef14", "1584622650111-993a426fbf0a", "1600566753190-17f0baa2a6c3",
    "1600210492486-724fe5c67fb0", "1586023492125-27b2c045efd7", "1600121848594-d8644e57abab",
    "1616594039964-ae9021a400a0", "1617806118233-18e1de247200", "1618221195710-dd6b41faaea6",
    "1615874959474-d609969a20ed", "1600494603989-9650cf6ddd3d", "1598928506311-c55ded91a20c",
]

# title, city, state, country, lat, lng, category, property_type, price, guests, bedrooms, cover-pool, special cover
LISTINGS = [
    ("Sea-facing villa with private pool", "Anjuna", "Goa", "India", 15.5735, 73.7407, "Beachfront", "Villa", 12500, 8, 4, "pool", None),
    ("Beach hut steps from Palolem", "Canacona", "Goa", "India", 15.0100, 74.0232, "Beachfront", "Cottage", 5200, 2, 1, "beach", None),
    ("Portuguese-style villa with plunge pool", "Assagao", "Goa", "India", 15.5966, 73.7710, "Amazing pools", "Villa", 18500, 10, 5, "pool", None),
    ("Pinewood cabin with Himalayan views", "Manali", "Himachal Pradesh", "India", 32.2396, 77.1887, "Cabins", "Cabin", 6400, 4, 2, "mountain", None),
    ("Apple orchard cottage in Old Manali", "Manali", "Himachal Pradesh", "India", 32.2532, 77.1802, "Amazing views", "Cottage", 4800, 3, 1, "mountain", None),
    ("Colonial heritage home near the Mall", "Shimla", "Himachal Pradesh", "India", 31.1048, 77.1734, "Historical homes", "House", 7900, 6, 3, "house", None),
    ("Riverside stay in Parvati Valley", "Kasol", "Himachal Pradesh", "India", 32.0100, 77.3150, "Camping", "Guesthouse", 2200, 2, 1, "mountain", None),
    ("Ganga-view retreat near Laxman Jhula", "Rishikesh", "Uttarakhand", "India", 30.1235, 78.3267, "Amazing views", "Guesthouse", 3500, 3, 1, "mountain", None),
    ("Royal haveli suite in the Pink City", "Jaipur", "Rajasthan", "India", 26.9124, 75.7873, "Castles", "House", 21000, 6, 3, "house", "1477587458883-47145ed94245"),
    ("Lake Pichola view heritage villa", "Udaipur", "Rajasthan", "India", 24.5764, 73.6800, "Lakefront", "Villa", 16500, 6, 3, "pool", None),
    ("Luxury desert camp under the stars", "Jaisalmer", "Rajasthan", "India", 26.9157, 70.9083, "Camping", "Guesthouse", 4200, 2, 1, "house", None),
    ("Coffee estate bungalow", "Madikeri", "Karnataka", "India", 12.4244, 75.7382, "Countryside", "Cottage", 5600, 6, 3, "house", None),
    ("Treehouse above the tea gardens", "Munnar", "Kerala", "India", 10.0889, 77.0595, "Treehouses", "Cabin", 7200, 2, 1, "mountain", None),
    ("Lakeside villa on the backwaters", "Alappuzha", "Kerala", "India", 9.4981, 76.3388, "Lakefront", "House", 9800, 4, 2, "tropical", "1602216056096-3b40cc0c9944"),
    ("Cliff-top stay above Varkala beach", "Varkala", "Kerala", "India", 8.7379, 76.7163, "Beachfront", "Guesthouse", 3900, 2, 1, "beach", None),
    ("French Quarter heritage home", "Puducherry", "Puducherry", "India", 11.9341, 79.8306, "Historical homes", "House", 6800, 5, 2, "house", None),
    ("Bandra loft with sea-link views", "Mumbai", "Maharashtra", "India", 19.0596, 72.8295, "Iconic cities", "Apartment", 8900, 3, 1, "city", None),
    ("Designer studio in Indiranagar", "Bengaluru", "Karnataka", "India", 12.9784, 77.6408, "Trending", "Apartment", 4500, 2, 1, "city", None),
    ("Lake-view flat in Hauz Khas Village", "New Delhi", "Delhi", "India", 28.5494, 77.2001, "Iconic cities", "Apartment", 5200, 4, 2, "city", None),
    ("Hilltop pool villa", "Lonavala", "Maharashtra", "India", 18.7546, 73.4062, "Amazing pools", "Villa", 14500, 12, 5, "pool", None),
    ("Beach villa with mango orchard", "Alibaug", "Maharashtra", "India", 18.6414, 72.8722, "Beachfront", "Villa", 13800, 8, 4, "beach", None),
    ("Cloud-end cottage in Landour", "Mussoorie", "Uttarakhand", "India", 30.4598, 78.0644, "Amazing views", "Cottage", 6100, 4, 2, "mountain", None),
    ("Ski-in log chalet", "Gulmarg", "Jammu and Kashmir", "India", 34.0484, 74.3805, "Skiing", "Cabin", 8800, 6, 3, "mountain", "1510798831971-661eb04b3739"),
    ("Snow-view chalet in Auli", "Auli", "Uttarakhand", "India", 30.5277, 79.5662, "Skiing", "Cottage", 5900, 4, 2, "mountain", None),
    ("Tea-estate cottage with Kanchenjunga views", "Darjeeling", "West Bengal", "India", 27.0410, 88.2663, "Countryside", "Cottage", 4300, 4, 2, "house", None),
    ("Tiny glass cabin in the clouds", "Sohra", "Meghalaya", "India", 25.2702, 91.7323, "Tiny homes", "Cabin", 3200, 2, 1, "mountain", None),
    ("Boulder-view stay across the river", "Hampi", "Karnataka", "India", 15.3350, 76.4600, "Historical homes", "Guesthouse", 2800, 2, 1, "house", None),
    ("Jungle villa near Radhanagar Beach", "Havelock Island", "Andaman and Nicobar", "India", 11.9761, 92.9876, "Tropical", "Villa", 15500, 4, 2, "tropical", None),
    ("Palm-shaded cottage near Om Beach", "Gokarna", "Karnataka", "India", 14.5479, 74.3188, "Tropical", "Cottage", 3600, 3, 1, "beach", None),
    ("Lake-view cottage on Naini lake", "Nainital", "Uttarakhand", "India", 29.3803, 79.4636, "Lakefront", "Cottage", 5400, 4, 2, "mountain", None),
    ("Jungle villa with infinity pool", "Ubud", "Bali", "Indonesia", -8.5069, 115.2625, "Tropical", "Villa", 11200, 4, 2, "tropical", "1537996194471-e657df975ab4"),
    ("Cave house overlooking the caldera", "Oia", "South Aegean", "Greece", 36.4618, 25.3753, "Amazing views", "Villa", 32000, 4, 2, "pool", "1570077188670-e3a8d69ac5ff"),
    ("Alfama apartment with river views", "Lisbon", "Lisbon", "Portugal", 38.7139, -9.1394, "Iconic cities", "Apartment", 9500, 4, 2, "city", None),
    ("Haussmann flat near the Seine", "Paris", "Île-de-France", "France", 48.8566, 2.3522, "Iconic cities", "Apartment", 16800, 4, 2, "city", "1502602898657-3e91760cbb34"),
    ("Minimalist loft in Shibuya", "Tokyo", "Tokyo", "Japan", 35.6580, 139.7016, "Trending", "Apartment", 8700, 2, 1, "city", "1540959733332-eab4deabeeaf"),
    ("Brooklyn brownstone garden suite", "New York", "New York", "United States", 40.6782, -73.9442, "Iconic cities", "Apartment", 22500, 3, 1, "city", "1496442226666-8d4d0e62e6e9"),
    ("Matterhorn-view ski chalet", "Zermatt", "Valais", "Switzerland", 46.0207, 7.7491, "Skiing", "Cabin", 38000, 8, 4, "mountain", None),
    ("Farmhouse among Tuscan vineyards", "Montepulciano", "Tuscany", "Italy", 43.0927, 11.7808, "Countryside", "Villa", 26000, 10, 5, "house", None),
    ("Restored castle in the Highlands", "Inverness", "Scotland", "United Kingdom", 57.4778, -4.2247, "Castles", "House", 45000, 12, 6, "house", None),
    ("Overwater villa with lagoon access", "Malé Atoll", "Kaafu", "Maldives", 4.1755, 73.5093, "Tropical", "Villa", 58000, 2, 1, "tropical", "1514282401047-d79a71a590e8"),
    ("Lakefront villa in Bellagio", "Bellagio", "Lombardy", "Italy", 45.9853, 9.2617, "Lakefront", "Villa", 34000, 8, 4, "pool", None),
    ("Rocky Mountain log cabin", "Banff", "Alberta", "Canada", 51.1784, -115.5708, "Cabins", "Cabin", 19500, 6, 3, "mountain", "1449158743715-0a90ebb6d2d8"),
    ("Ocean-view mansion", "Malibu", "California", "United States", 34.0259, -118.7798, "Mansions", "House", 85000, 14, 7, "pool", None),
    ("Palm Jumeirah private beach villa", "Dubai", "Dubai", "United Arab Emirates", 25.1124, 55.1390, "Mansions", "Villa", 52000, 12, 6, "pool", None),
    ("Desert dome under dark skies", "Joshua Tree", "California", "United States", 34.1347, -116.3131, "Tiny homes", "Cabin", 12500, 2, 1, "house", None),
    ("Traditional machiya townhouse", "Kyoto", "Kyoto", "Japan", 35.0116, 135.7681, "Historical homes", "House", 14200, 4, 2, "house", None),
    ("Cliffside pool villa", "Phuket", "Phuket", "Thailand", 7.8804, 98.3923, "Amazing pools", "Villa", 17800, 6, 3, "pool", None),
    ("Lake-view house with alpine views", "Queenstown", "Otago", "New Zealand", -45.0312, 168.6626, "Amazing views", "House", 21500, 6, 3, "mountain", "1470770841072-f978cf4d019e"),
    ("Camps Bay villa with ocean views", "Cape Town", "Western Cape", "South Africa", -33.9510, 18.3774, "Trending", "Villa", 16000, 6, 3, "pool", None),
    ("A-frame cabin on Lake Tahoe", "South Lake Tahoe", "California", "United States", 38.9399, -119.9772, "Lakefront", "Cabin", 24500, 6, 3, "mountain", None),
    ("Rainforest treehouse", "Monteverde", "Puntarenas", "Costa Rica", 10.3009, -84.8250, "Treehouses", "Cabin", 9800, 2, 1, "tropical", None),
    ("Glass-walled studio by the river", "Rishikesh", "Uttarakhand", "India", 30.1086, 78.2972, "Trending", "Apartment", 3100, 2, 1, "city", None),
]

AMENITY_BY_CATEGORY = {
    "Beachfront": ["Beach access", "Pool"], "Amazing pools": ["Pool", "Hot tub"],
    "Cabins": ["Indoor fireplace", "Mountain view", "Heating"], "Skiing": ["Ski-in/ski-out", "Indoor fireplace", "Heating"],
    "Amazing views": ["Mountain view"], "Lakefront": ["Lake access"], "Tropical": ["Pool", "Garden"],
    "Countryside": ["Garden", "BBQ grill"], "Mansions": ["Pool", "Gym", "Hot tub"], "Camping": ["BBQ grill"],
}
BASE_AMENITIES = ["Wifi", "Kitchen", "Smoke alarm"]
OPTIONAL_AMENITIES = ["Free parking on premises", "Air conditioning", "Washer", "Dedicated workspace", "TV",
                      "Pets allowed", "Self check-in", "Breakfast", "Gym", "Garden", "BBQ grill"]

DESCRIPTION = (
    "Welcome to {title_lower} in {city}. Wake up to natural light, slow mornings and a space "
    "designed for unwinding. The home sleeps {guests} across {bedrooms} bedroom(s), with a fully "
    "equipped kitchen, fast Wi-Fi and thoughtful local touches throughout.\n\n"
    "The space\nOpen-plan living, comfortable beds with fresh linen, and plenty of spots to read, work "
    "or just take in the view.\n\nGetting around\nCafés, markets and the best local sights are a short "
    "walk or drive away. We're happy to share our favourite spots when you arrive."
)

REVIEW_TEXT = [
    (5, "Absolutely loved our stay. The place was spotless and even prettier than the photos."),
    (5, "One of the best Airbnb-style stays we've had. Host was super responsive and the location was perfect."),
    (5, "Beautiful home, great views and a really comfortable bed. Would book again in a heartbeat."),
    (4, "Lovely property and great value. Check-in was smooth; Wi-Fi was a little slow in the evenings."),
    (5, "Peaceful, clean and exactly as described. The little welcome touches made it feel like home."),
    (4, "Great location and a cosy space. The kitchen had everything we needed for a long weekend."),
    (5, "The host went above and beyond with recommendations. The sunsets from the balcony were unreal."),
    (3, "Nice place overall, but the road to the property was harder to find than expected."),
    (5, "Perfect for a workcation — quiet, fast internet and a great desk setup."),
    (4, "Had a wonderful time with family. Plenty of space and the kids loved the garden."),
    (5, "Stylish, comfortable and very well located. Communication with the host was excellent."),
    (4, "Really enjoyed it. A couple of minor things to fix, but the host sorted them out quickly."),
]


def _photos(rng: random.Random, pool: str, special: str | None) -> list[str]:
    covers = COVERS[pool][:]
    rng.shuffle(covers)
    first = [special] if special else []
    exteriors = first + [c for c in covers if c != special][: 2 - len(first)]
    interiors = rng.sample(INTERIORS, 4)
    return [U.format(pid) for pid in exteriors + interiors]


def seed(db: Session) -> None:
    rng = random.Random(42)
    today = date.today()

    amenities = {name: Amenity(name=name, icon=icon) for name, icon in AMENITIES}
    db.add_all(amenities.values())

    hosts = []
    for i, (name, email, img, superhost, bio) in enumerate(HOSTS):
        hosts.append(User(
            name=name, email=email, avatar_url=f"https://i.pravatar.cc/150?img={img}", bio=bio,
            is_host=True, is_superhost=superhost,
            created_at=datetime.now() - timedelta(days=400 * (i + 2)),
        ))
    guests = [
        User(name=n, email=e, avatar_url=f"https://i.pravatar.cc/150?img={img}", is_host=False,
             created_at=datetime.now() - timedelta(days=200 + i * 37))
        for i, (n, e, img) in enumerate(GUESTS)
    ]
    db.add_all(hosts + guests)
    db.flush()

    listings: list[Listing] = []
    for i, (title, city, state, country, lat, lng, cat, ptype, price, max_g, beds_n, pool, special) in enumerate(LISTINGS):
        names = set(BASE_AMENITIES) | set(AMENITY_BY_CATEGORY.get(cat, [])) | set(rng.sample(OPTIONAL_AMENITIES, 4))
        listing = Listing(
            host=hosts[i % len(hosts)], title=title,
            description=DESCRIPTION.format(title_lower=title.lower(), city=city, guests=max_g, bedrooms=beds_n),
            property_type=ptype, category=cat, city=city, state=state, country=country,
            latitude=lat, longitude=lng, price_per_night=price,
            cleaning_fee=round(price * 0.12 / 100) * 100, max_guests=max_g, bedrooms=beds_n,
            beds=beds_n + (1 if max_g > beds_n * 2 else 0), bathrooms=max(1, (beds_n + 1) // 2),
            amenities=[amenities[n] for n in sorted(names)],
            photos=[ListingPhoto(url=u, position=p) for p, u in enumerate(_photos(rng, pool, special))],
            created_at=datetime.now() - timedelta(days=rng.randint(30, 900)),
        )
        listings.append(listing)
    db.add_all(listings)
    db.flush()

    taken: dict[int, list[tuple[date, date]]] = {}  # listing id -> confirmed [check_in, check_out)

    def book(listing: Listing, guest: User, start: date, nights: int, status: str = "confirmed",
             cancelled_by: str | None = None) -> Booking:
        if status == "confirmed":
            # never double-book: slide forward until the stay fits between existing ones
            ranges = taken.setdefault(listing.id, [])
            while any(start < b and a < start + timedelta(days=nights) for a, b in ranges):
                start += timedelta(days=1)
            ranges.append((start, start + timedelta(days=nights)))
        price = calculate_price(listing.price_per_night, listing.cleaning_fee, start, start + timedelta(days=nights))
        b = Booking(
            listing=listing, guest=guest, check_in=start, check_out=start + timedelta(days=nights),
            guests=min(2, listing.max_guests), nightly_rate=price.nightly_rate, nights=price.nights,
            cleaning_fee=price.cleaning_fee, service_fee=price.service_fee, taxes=price.taxes,
            total_price=price.total, status=status,
            cancelled_by=(cancelled_by or "guest") if status == "cancelled" else None,
            created_at=min(datetime.now(), datetime.combine(start - timedelta(days=rng.randint(5, 40)), datetime.min.time())),
        )
        if status == "cancelled":
            b.cancelled_at = min(datetime.now(), b.created_at + timedelta(days=2))
        db.add(b)
        return b

    reviewers = guests[2:]
    for listing in listings:
        # past stays, most of them reviewed
        cursor = today - timedelta(days=rng.randint(200, 320))
        for _ in range(rng.randint(3, 9)):
            nights = rng.randint(2, 5)
            if cursor + timedelta(days=nights) >= today - timedelta(days=3):
                break
            guest = rng.choice(reviewers)
            b = book(listing, guest, cursor, nights)
            rating, text = rng.choices(REVIEW_TEXT, weights=[{5: 8, 4: 3, 3: 0.4}[r] for r, _ in REVIEW_TEXT])[0]
            db.add(Review(
                listing=listing, author=guest, booking=b, rating=rating, comment=text,
                created_at=datetime.combine(b.check_out + timedelta(days=rng.randint(1, 5)), datetime.min.time()),
            ))
            cursor += timedelta(days=nights + rng.randint(4, 30))
        # upcoming reservations that block calendar dates
        start = today + timedelta(days=rng.randint(3, 12))
        for _ in range(rng.randint(1, 3)):
            nights = rng.randint(2, 6)
            book(listing, rng.choice(reviewers), start, nights)
            start += timedelta(days=nights + rng.randint(3, 15))

    # Demo guest (Aarav): upcoming + past trips, one past trip left unreviewed to demo "Leave a review"
    aarav, sofia = guests[0], guests[1]
    book(listings[0], aarav, today + timedelta(days=40), 4)
    book(listings[30], aarav, today + timedelta(days=75), 5)
    past = book(listings[8], aarav, today - timedelta(days=60), 3)
    db.add(Review(listing=listings[8], author=aarav, booking=past, rating=5,
                  comment="Felt like royalty. The courtyard breakfast was the highlight of our Jaipur trip.",
                  created_at=datetime.combine(today - timedelta(days=55), datetime.min.time())))
    book(listings[3], aarav, today - timedelta(days=20), 3)  # completed, not yet reviewed
    book(listings[16], aarav, today + timedelta(days=100), 2, status="cancelled")
    # ...and one the host had to cancel, to demo the "Cancelled by host" card + refund banner
    book(listings[21], aarav, today + timedelta(days=50), 3, status="cancelled", cancelled_by="host")
    book(listings[12], sofia, today + timedelta(days=30), 3)

    db.commit()


# Columns added after the first release: (table, column, DDL type). create_all() never
# alters existing tables, so older SQLite files get them via ALTER TABLE on boot.
MIGRATIONS = [
    ("bookings", "cancelled_by", "VARCHAR(10)"),
    ("bookings", "cancelled_at", "DATETIME"),
    ("experience_bookings", "cancelled_by", "VARCHAR(10)"),
    ("experience_bookings", "cancelled_at", "DATETIME"),
]


def migrate() -> None:
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table, column, ddl in MIGRATIONS:
            if table in tables and column not in {c["name"] for c in insp.get_columns(table)}:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
                if column == "cancelled_by":
                    # before this column existed only guests could cancel from the UI they used most
                    conn.execute(text(f"UPDATE {table} SET cancelled_by = 'guest' WHERE status = 'cancelled'"))


def init_db(reset: bool = False) -> None:
    if reset:
        Base.metadata.drop_all(engine)
    migrate()
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if db.scalar(select(User.id).limit(1)) is None:
            seed(db)
            print("Seeded database")
        if db.scalar(select(Experience.id).limit(1)) is None:
            seed_experiences(db)
            print("Seeded experiences and services")
        # runs on existing databases too, so an upgraded install gets the sample threads
        if db.scalar(select(Conversation.id).limit(1)) is None:
            seed_messages(db)
            print("Seeded message threads")


if __name__ == "__main__":
    init_db(reset="--reset" in sys.argv)
