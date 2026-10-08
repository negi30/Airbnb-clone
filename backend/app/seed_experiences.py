"""Seed experiences + services, their time slots, bookings and reviews.

Runs on its own (when the experiences table is empty) so databases created
before this feature existed get populated without a reset. Slots are generated
relative to *now*, so "Happening today / tomorrow / this weekend" always has data.
"""
import random
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import (
    Experience,
    ExperienceActivity,
    ExperienceBooking,
    ExperiencePhoto,
    ExperienceReview,
    ExperienceSlot,
    User,
)
from .services.pricing import calculate_experience_price

U = "https://images.unsplash.com/photo-{}?auto=format&fit=crop&w=1200&q=80"

# Each entry:
#   kind, title, tagline, category, host email, host title,
#   (city, state, country, meeting point, address, lat, lng),
#   price/guest, minutes, max guests, included, private groups, daily start times,
#   photo ids, [(activity title, activity text, photo id)]
CATALOG = [
    # ---------------------------------------------------------------- experiences: New Delhi
    ("experience", "Chai Workshop & Food in Local Indian Family Home",
     "Master the art of chai, craft your unique spice blend, and uncover its historical roots.",
     "Cooking", "leo@example.com", "Cooking instructor",
     ("New Delhi", "Delhi", "India", "Greater Kailash-1", "New Delhi, Delhi, 110048", 28.5494, 77.2378),
     3000, 60, 8, "Light bites and speciality drinks", True, ["09:00", "11:00", "15:00", "18:00", "21:30"],
     ["1571934811356-5cc061b6821f", "1556679343-c7306c1976bc", "1544787219-7f47ccb76574", "1597481499750-3e6b22637e12"],
     [("Visit an Indian home", "Discover chai's history & what makes Indian tea unique.", "1556910103-1c02745aae4d"),
      ("Craft a spice blend", "Learn chai spices: flavour, aroma & make your own blend.", "1596040033229-a9821ebd058d"),
      ("Brew & taste", "Brew masala chai the traditional way and pair it with homemade snacks.", "1571934811356-5cc061b6821f")]),
    ("experience", "Old Delhi: Hidden Gems with Local's Life & Tuk-Tuk",
     "Wander the lanes of Shahjahanabad, meet artisans and ride a tuk-tuk through history.",
     "Cultural tours", "ananya@example.com", "Heritage guide",
     ("New Delhi", "Delhi", "India", "Chandni Chowk Metro, Gate 5", "Chandni Chowk, Delhi, 110006", 28.6580, 77.2303),
     1900, 180, 10, "Tuk-tuk ride, chai and a street snack", True, ["08:30", "16:00"],
     ["1587474260584-136574528ed5", "1597040663342-45b6af3d91a5", "1524492412937-b28074a5d7da"],
     [("Meet at Chandni Chowk", "Start at one of India's oldest markets with a quick history primer.", "1597040663342-45b6af3d91a5"),
      ("Spice market & havelis", "Explore Khari Baoli and centuries-old mansions hidden in the lanes.", "1596040033229-a9821ebd058d"),
      ("Tuk-tuk to Jama Masjid", "Ride through the old city to India's largest mosque.", "1587474260584-136574528ed5")]),
    ("experience", "Explore Delhi's Street Food",
     "Twelve tastings across Old Delhi's most loved stalls, from parathas to jalebis.",
     "Food tours", "ananya@example.com", "Food writer",
     ("New Delhi", "Delhi", "India", "Paranthe Wali Gali", "Chandni Chowk, Delhi, 110006", 28.6562, 77.2310),
     2500, 210, 8, "All food and drinks", False, ["10:00", "16:30"],
     ["1601050690597-df0568f70950", "1585937421612-70a008356fbe", "1567188040759-fb8a883dc6d8"],
     [("Parathas for breakfast", "Stuffed, fried and served with pickles in a 150-year-old lane.", "1601050690597-df0568f70950"),
      ("Chaat crawl", "Golgappe, aloo tikki and dahi bhalla from family-run stalls.", "1585937421612-70a008356fbe"),
      ("Something sweet", "Finish with hot jalebis and kulfi.", "1567188040759-fb8a883dc6d8")]),
    ("experience", "Hands-on Indian Cooking in a Real Indian Home",
     "Cook a four-course North Indian meal with a family and eat it together.",
     "Cooking", "priya@example.com", "Home chef",
     ("New Delhi", "Delhi", "India", "Lajpat Nagar", "New Delhi, Delhi, 110024", 28.5677, 77.2433),
     5999, 240, 6, "Full lunch or dinner and recipes", True, ["10:00", "17:00"],
     ["1556910103-1c02745aae4d", "1585937421612-70a008356fbe", "1596797038530-2c107229654b"],
     [("Market visit", "Pick fresh vegetables and spices at the local market.", "1596040033229-a9821ebd058d"),
      ("Cook together", "Make dal, a curry, rotis and raita from scratch.", "1556910103-1c02745aae4d"),
      ("Family meal", "Sit down and eat what you cooked with your hosts.", "1585937421612-70a008356fbe")]),
    ("experience", "Lodhi Art District Street Art Walk with Chai",
     "India's first open-air public art district, explained by an artist.",
     "Art & design", "daniel@example.com", "Street artist",
     ("New Delhi", "Delhi", "India", "Lodhi Colony Market", "Lodhi Colony, New Delhi, 110003", 28.5880, 77.2240),
     3000, 120, 10, "Chai and biscuits", False, ["08:00", "16:00"],
     ["1460661419201-fd4cecdf8a8b", "1513364776144-60967b0f800f", "1499781350541-7783f6c6a0c8"],
     [("Murals & their makers", "Walk through 50+ murals by Indian and international artists.", "1460661419201-fd4cecdf8a8b"),
      ("Sketch your own", "Try a quick stencil with the artist's tools.", "1513364776144-60967b0f800f")]),
    ("experience", "Handblock Printing Workshop in Delhi",
     "Print your own scarf with hand-carved wooden blocks and natural dyes.",
     "Art & design", "meera@example.com", "Textile artist",
     ("New Delhi", "Delhi", "India", "Hauz Khas Village", "Hauz Khas, New Delhi, 110016", 28.5535, 77.1940),
     6000, 150, 6, "Materials and your printed scarf", True, ["11:00", "18:00"],
     ["1565193566173-7a0ee3dbe261", "1528396518501-b53b655eb9b3", "1513364776144-60967b0f800f"],
     [("Choose your blocks", "Pick from 200 hand-carved teak blocks.", "1528396518501-b53b655eb9b3"),
      ("Print & set", "Layer colours on cotton and learn how natural dyes are fixed.", "1565193566173-7a0ee3dbe261")]),
    ("experience", "Same-Day Taj Mahal & Agra Fort Tour from Delhi",
     "Skip-the-line Taj Mahal at sunrise, Agra Fort and lunch, with hotel pickup.",
     "Landmarks", "rohan@example.com", "Licensed guide",
     ("New Delhi", "Delhi", "India", "Your hotel in Delhi", "Pickup anywhere in Delhi NCR", 28.6139, 77.2090),
     4000, 600, 6, "Private car, entry tickets and lunch", True, ["02:30", "06:00"],
     ["1564507592333-c60657eea523", "1548013146-72479768bada", "1524492412937-b28074a5d7da"],
     [("Sunrise at the Taj", "Beat the crowds and see the marble glow at dawn.", "1564507592333-c60657eea523"),
      ("Agra Fort", "The red sandstone fort where Shah Jahan spent his final years.", "1548013146-72479768bada"),
      ("Lunch & drive back", "A Mughlai lunch before the expressway home.", "1585937421612-70a008356fbe")]),
    ("experience", "Delhi Shopping Tour: Markets & Boutiques",
     "From Sarojini bargains to Khan Market boutiques, shop like a local.",
     "Cultural tours", "meera@example.com", "Stylist",
     ("New Delhi", "Delhi", "India", "Khan Market", "Khan Market, New Delhi, 110003", 28.6003, 77.2270),
     3699, 240, 4, "Snacks and a pashmina-buying guide", False, ["11:00", "17:00"],
     ["1555529669-e69e7aa0ba9a", "1483985988355-763728e1935b", "1528396518501-b53b655eb9b3"],
     [("Market hopping", "Three markets, three price points, one tuk-tuk.", "1555529669-e69e7aa0ba9a")]),
    # ---------------------------------------------------------------- experiences: elsewhere
    ("experience", "Goa Sunset Kayaking in the Mangroves",
     "Paddle quiet backwaters at golden hour and spot kingfishers and otters.",
     "Outdoors", "rohan@example.com", "Kayak instructor",
     ("Panaji", "Goa", "India", "Chorão Island jetty", "Chorão, Goa, 403102", 15.5180, 73.8560),
     2200, 150, 10, "Kayak, life jacket and a coconut", False, ["07:00", "16:30"],
     ["1544551763-46a013bb70d5", "1507525428034-b723cf961d3e", "1512343879784-a960bf40e7f2"],
     [("Safety briefing", "Learn the basics on the jetty.", "1544551763-46a013bb70d5"),
      ("Mangrove paddle", "Glide through narrow channels as the sun sets.", "1507525428034-b723cf961d3e")]),
    ("experience", "Learn to Surf at Arambol",
     "Two-hour beginner lesson with a certified coach and all the gear.",
     "Outdoors", "daniel@example.com", "Surf coach",
     ("Arambol", "Goa", "India", "Arambol Beach, north end", "Arambol, Goa, 403524", 15.6869, 73.7046),
     2800, 120, 6, "Board, rash guard and photos", False, ["08:00", "15:00"],
     ["1502680390469-be75c86b636f", "1530053969600-caed2596d242", "1507525428034-b723cf961d3e"],
     [("Beach drills", "Pop-ups and paddling on the sand.", "1502680390469-be75c86b636f"),
      ("Catch waves", "Hands-on coaching in the white water.", "1530053969600-caed2596d242")]),
    ("experience", "Mumbai After Dark: Bars & Bites of Bandra",
     "Hop between three hidden bars with a local and eat your way through Bandra.",
     "Nightlife", "priya@example.com", "Bartender",
     ("Mumbai", "Maharashtra", "India", "Bandra Bandstand", "Bandra West, Mumbai, 400050", 19.0544, 72.8203),
     3500, 180, 8, "Three drinks and small plates", False, ["20:00"],
     ["1533174072545-7a4b6ad7a6c3", "1514525253161-7a46d19cd819", "1517248135467-4c7edcad34c4"],
     [("First round", "A craft cocktail bar in a restored bungalow.", "1533174072545-7a4b6ad7a6c3"),
      ("Street food stop", "Vada pav and kebabs from late-night legends.", "1601050690597-df0568f70950")]),
    ("experience", "Jaipur Pink City Heritage Walk",
     "Hawa Mahal, hidden step-wells and the bazaars of the walled city.",
     "Landmarks", "ananya@example.com", "Historian",
     ("Jaipur", "Rajasthan", "India", "Hawa Mahal", "Badi Choupad, Jaipur, 302002", 26.9239, 75.8267),
     1800, 180, 12, "Chai and kachori", False, ["07:30", "16:00"],
     ["1477587458883-47145ed94245", "1599661046289-e31897846e41", "1524492412937-b28074a5d7da"],
     [("Hawa Mahal", "The palace of winds and its 953 windows.", "1477587458883-47145ed94245"),
      ("Bazaar lanes", "Gemstones, block prints and bangles.", "1555529669-e69e7aa0ba9a")]),
    ("experience", "Sunrise Yoga & Meditation on the Ganges",
     "A gentle riverside practice followed by breakfast at an ashram café.",
     "Wellness", "rohan@example.com", "Yoga teacher",
     ("Rishikesh", "Uttarakhand", "India", "Ram Jhula ghat", "Rishikesh, Uttarakhand, 249304", 30.1240, 78.3150),
     1500, 90, 15, "Mat and breakfast", False, ["06:00", "17:30"],
     ["1544367567-0f2fcb009e0b", "1506126613408-eca07ce68773", "1545389336-cf090694435e"],
     [("Breathwork", "Pranayama by the water.", "1506126613408-eca07ce68773"),
      ("Flow", "An hour of hatha for every level.", "1544367567-0f2fcb009e0b")]),
    ("experience", "Bengaluru Craft Coffee Tasting",
     "Taste single-estate coffees from Chikmagalur and learn to brew them at home.",
     "Food tours", "meera@example.com", "Barista",
     ("Bengaluru", "Karnataka", "India", "Indiranagar 12th Main", "Indiranagar, Bengaluru, 560038", 12.9719, 77.6412),
     2100, 90, 8, "Six coffees and a bag of beans", False, ["10:00", "16:00"],
     ["1495474472287-4d71bcdd2085", "1447933601403-0c6688de566e", "1509042239860-f550ce710b93"],
     [("Cupping", "Score coffees like a pro.", "1447933601403-0c6688de566e"),
      ("Brew lab", "Pour-over, AeroPress and South Indian filter.", "1495474472287-4d71bcdd2085")]),
    ("experience", "Hidden Kyoto Temple Walk",
     "Quiet temples, moss gardens and matcha, away from the tour buses.",
     "Cultural tours", "leo@example.com", "Local guide",
     ("Kyoto", "Kyoto", "Japan", "Demachiyanagi Station", "Sakyo Ward, Kyoto", 35.0303, 135.7729),
     2100, 180, 8, "Matcha and a wagashi sweet", False, ["09:00", "14:00"],
     ["1493976040374-85c8e12f0c0e", "1545569341-9eb8b30979d9", "1528360983277-13d401cdc186"],
     [("Moss garden", "A 13th-century garden few visitors find.", "1545569341-9eb8b30979d9"),
      ("Tea break", "Matcha whisked by a tea master.", "1528360983277-13d401cdc186")]),
    ("experience", "Pasta Making Masterclass in Montmartre",
     "Roll, cut and fill three fresh pastas with a chef, then eat them with wine.",
     "Cooking", "leo@example.com", "Chef",
     ("Paris", "Île-de-France", "France", "Rue Lepic", "Montmartre, Paris, 75018", 48.8867, 2.3333),
     3500, 180, 10, "Dinner with wine", True, ["11:00", "18:30"],
     ["1556910103-1c02745aae4d", "1551183053-bf91a1d81141", "1473093295043-cdd812d0e601"],
     [("Make the dough", "Flour, eggs and technique.", "1551183053-bf91a1d81141"),
      ("Shape & cook", "Tagliatelle, ravioli and orecchiette.", "1473093295043-cdd812d0e601")]),
    # ---------------------------------------------------------------- services
    ("service", "Professional Vacation Photography",
     "A relaxed photo walk at Delhi's most beautiful spots, with 40+ edited photos.",
     "Photography", "nina@example.com", "Photographer",
     ("New Delhi", "Delhi", "India", "India Gate or Humayun's Tomb", "New Delhi, Delhi", 28.6129, 77.2295),
     8000, 60, 6, "40 edited photos within 48 hours", True, ["07:00", "16:30"],
     ["1516035069371-29a1b244cc32", "1502920917128-1aa500764cbd", "1452587925148-ce544e77e70d"],
     [("Mini session", "30 minutes at one location, 15 edited photos.", "1502920917128-1aa500764cbd"),
      ("Signature shoot", "60 minutes, two locations, 40 edited photos.", "1516035069371-29a1b244cc32")]),
    ("service", "Couples & Proposal Photoshoot",
     "Discreet, candid coverage of your big moment, planned with you in advance.",
     "Photography", "nina@example.com", "Wedding photographer",
     ("Jaipur", "Rajasthan", "India", "Amer Fort or your venue", "Jaipur, Rajasthan", 26.9855, 75.8513),
     12000, 90, 2, "Location scouting and 60 edited photos", True, ["06:30", "17:00"],
     ["1511285560929-80b456fea0bc", "1519741497674-611481863552", "1452587925148-ce544e77e70d"],
     [("Planning call", "We pick the spot, time and story.", "1519741497674-611481863552"),
      ("The shoot", "Candid coverage of the moment and portraits after.", "1511285560929-80b456fea0bc")]),
    ("service", "Private Chef: North Indian Dinner at Your Stay",
     "A chef cooks a five-course dinner in your rental kitchen and cleans up after.",
     "Chefs", "priya@example.com", "Private chef",
     ("New Delhi", "Delhi", "India", "Your stay in Delhi", "Anywhere in Delhi NCR", 28.5700, 77.2100),
     4500, 180, 12, "Groceries, cooking and clean-up", True, ["19:00"],
     ["1577219491135-ce391730fb2c", "1414235077428-338989a2e8c0", "1585937421612-70a008356fbe"],
     [("Tasting menu", "Five courses from kebabs to kulfi.", "1414235077428-338989a2e8c0"),
      ("Family style", "Big platters of curries, breads and rice.", "1585937421612-70a008356fbe")]),
    ("service", "Goan Seafood Feast by a Private Chef",
     "Fresh catch of the day cooked Goan-style at your villa.",
     "Chefs", "leo@example.com", "Private chef",
     ("Anjuna", "Goa", "India", "Your villa in North Goa", "North Goa", 15.5735, 73.7407),
     5200, 180, 10, "Groceries, cooking and clean-up", True, ["13:00", "19:30"],
     ["1581299894007-aaa50297cf16", "1559339352-11d035aa65de", "1555939594-58d7cb561ad1"],
     [("Recheado & xacuti", "Classic Goan masalas, ground fresh.", "1559339352-11d035aa65de")]),
    ("service", "Healthy Prepared Meals Delivered to Your Stay",
     "A week of balanced, home-style meals delivered daily, tailored to your diet.",
     "Prepared meals", "meera@example.com", "Nutritionist",
     ("Bengaluru", "Karnataka", "India", "Delivered to your stay", "Anywhere in Bengaluru", 12.9716, 77.5946),
     900, 30, 6, "Lunch and dinner for one day", False, ["12:00"],
     ["1512621776951-a57141f2eefd", "1540189549336-e6e99c3679fe", "1546069901-ba9599a7e63c"],
     [("Daily menu", "Two meals a day, rotating seasonal recipes.", "1540189549336-e6e99c3679fe")]),
    ("service", "In-Villa Ayurvedic Massage",
     "A licensed therapist brings a table, oils and calm to your stay.",
     "Massage", "ananya@example.com", "Massage therapist",
     ("Anjuna", "Goa", "India", "Your stay in Goa", "North & South Goa", 15.5800, 73.7500),
     3200, 60, 2, "Massage table, warm oils and towels", False, ["10:00", "14:00", "18:00"],
     ["1544161515-4ab6ce6db874", "1600334089648-b0d9d3028eb2", "1540555700478-4be289fbecef"],
     [("Abhyanga", "Full-body warm-oil massage, 60 min.", "1544161515-4ab6ce6db874"),
      ("Shirodhara", "A stream of warm oil on the forehead, 45 min.", "1600334089648-b0d9d3028eb2")]),
    ("service", "Deep-Tissue Massage at Your Hotel",
     "Recover from long flights with a therapist who comes to you.",
     "Massage", "ananya@example.com", "Sports therapist",
     ("New Delhi", "Delhi", "India", "Your stay in Delhi", "Anywhere in Delhi NCR", 28.5900, 77.2200),
     3800, 75, 2, "Table, oils and towels", False, ["09:00", "13:00", "19:00"],
     ["1600334089648-b0d9d3028eb2", "1544161515-4ab6ce6db874", "1519823551278-64ac92734fb1"],
     [("Deep tissue", "Targeted pressure for back and shoulders.", "1519823551278-64ac92734fb1")]),
    ("service", "Glow Facial & Spa Treatment",
     "A 90-minute facial with organic products, in the comfort of your room.",
     "Spa treatments", "priya@example.com", "Esthetician",
     ("Mumbai", "Maharashtra", "India", "Your stay in Mumbai", "South Mumbai & Bandra", 19.0600, 72.8300),
     4200, 90, 2, "Products and equipment", False, ["11:00", "16:00"],
     ["1570172619644-dfd03ed5d881", "1540555700478-4be289fbecef", "1600334089648-b0d9d3028eb2"],
     [("Cleanse & glow", "Double cleanse, exfoliation and mask.", "1570172619644-dfd03ed5d881")]),
    ("service", "Personal Training by the Beach",
     "A tailored HIIT and mobility session on the sand with a certified trainer.",
     "Training", "daniel@example.com", "Personal trainer",
     ("Panaji", "Goa", "India", "Miramar Beach", "Miramar, Panaji, Goa", 15.4760, 73.8070),
     1800, 60, 4, "Equipment and a recovery plan", False, ["06:30", "17:30"],
     ["1571019613454-1cb2f99b2d8b", "1517836357463-d25dfeac3438", "1534438327276-14e5300c3a48"],
     [("Assessment", "Mobility check and goals.", "1517836357463-d25dfeac3438"),
      ("Workout", "40 minutes of strength and conditioning.", "1571019613454-1cb2f99b2d8b")]),
    ("service", "Bridal & Party Make-up Artist",
     "Event-ready make-up and draping, at your stay or venue.",
     "Make-up", "nina@example.com", "Make-up artist",
     ("New Delhi", "Delhi", "India", "Your stay or venue", "Anywhere in Delhi NCR", 28.5400, 77.2000),
     6500, 120, 4, "Premium products and saree draping", False, ["08:00", "15:00"],
     ["1487412947147-5cebf100ffc2", "1522337360788-8b13dee7a37e", "1503236823255-94609f598e71"],
     [("Party look", "Full make-up and hair styling.", "1487412947147-5cebf100ffc2")]),
    ("service", "Haircut & Styling at Your Stay",
     "A senior stylist brings the salon to you: cut, blow-dry and styling.",
     "Hair", "nina@example.com", "Hair stylist",
     ("Mumbai", "Maharashtra", "India", "Your stay in Mumbai", "Anywhere in Mumbai", 19.0760, 72.8777),
     2500, 60, 3, "Products and tools", False, ["10:00", "14:00", "18:00"],
     ["1560066984-138dadb4c035", "1522337360788-8b13dee7a37e", "1521590832167-7bcbfaa6381f"],
     [("Cut & blow-dry", "Consultation, wash, cut and style.", "1560066984-138dadb4c035")]),
    ("service", "Gel Manicure & Pedicure",
     "Long-lasting gel nails and a relaxing pedicure, wherever you're staying.",
     "Nails", "meera@example.com", "Nail artist",
     ("Bengaluru", "Karnataka", "India", "Your stay in Bengaluru", "Central Bengaluru", 12.9750, 77.6000),
     1600, 75, 2, "Polish, tools and nail art", False, ["11:00", "15:00", "18:30"],
     ["1604654894610-df63bc536371", "1610992015732-2449b76344bc", "1519014816548-bf5fe059798b"],
     [("Gel mani", "Shape, cuticle care and gel colour.", "1604654894610-df63bc536371")]),
]

DESCRIPTION = (
    "{tagline}\n\n"
    "Your host is a {host_title_lower} who has been sharing this with travellers for years. Expect a small, "
    "friendly group, plenty of time for questions and local tips you won't find in guidebooks.\n\n"
    "Good to know\nPlease arrive 10 minutes early. {included} are included. Let your host know about any "
    "dietary needs or accessibility requirements after booking."
)

REVIEW_TEXT = [
    (5, "Absolutely the highlight of our trip. Warm, knowledgeable and so much fun."),
    (5, "Our host made us feel like family. We learnt so much and laughed the whole time."),
    (5, "Well organised, great pace and fantastic stories. Highly recommend!"),
    (5, "Worth every rupee. I'd book this again in a heartbeat."),
    (4, "Really enjoyed it. A little rushed at the end but still wonderful."),
    (5, "Exactly as described and then some. Easy to find and super welcoming."),
    (5, "Professional, punctual and genuinely passionate. Loved it."),
    (4, "Great value and a lovely host. Would have liked a bit more time."),
    (5, "Didn't want it to end. One of the best things we did in India."),
    (5, "Thoughtful, personal and beautifully done. Thank you!"),
]


def _at(day: date, hhmm: str) -> datetime:
    h, m = map(int, hhmm.split(":"))
    return datetime.combine(day, time(h, m))


def seed_experiences(db: Session) -> None:
    rng = random.Random(7)
    today = date.today()
    now = datetime.now()

    users = db.scalars(select(User).order_by(User.id)).all()
    by_email = {u.email: u for u in users}
    hosts = [u for u in users if u.is_host]
    guests = [u for u in users if not u.is_host]
    if not hosts or not guests:
        return

    experiences: list[Experience] = []
    for (kind, title, tagline, category, host_email, host_title, place, price, minutes, max_g,
         included, private, times, photo_ids, activities) in CATALOG:
        city, state, country, meeting, address, lat, lng = place
        exp = Experience(
            host=by_email.get(host_email) or hosts[len(experiences) % len(hosts)],
            kind=kind, title=title, tagline=tagline, category=category, host_title=host_title,
            description=DESCRIPTION.format(tagline=tagline, host_title_lower=host_title.lower(), included=included),
            city=city, state=state, country=country, meeting_point=meeting, address=address,
            latitude=lat, longitude=lng, price_per_guest=price, duration_minutes=minutes, max_guests=max_g,
            language="English", included=included, free_cancellation=True, private_groups=private,
            photos=[ExperiencePhoto(url=U.format(pid), position=i) for i, pid in enumerate(photo_ids)],
            activities=[
                ExperienceActivity(position=i, title=t, description=d, photo_url=U.format(pid))
                for i, (t, d, pid) in enumerate(activities)
            ],
            created_at=now - timedelta(days=rng.randint(60, 900)),
        )
        # upcoming schedule: four weeks, most slots open
        for offset in range(0, 28):
            day = today + timedelta(days=offset)
            for hhmm in times:
                if offset > 1 and rng.random() < 0.2:
                    continue
                exp.slots.append(ExperienceSlot(starts_at=_at(day, hhmm), capacity=max_g))
        # past occurrences that carry the reviews
        for offset in sorted(rng.sample(range(3, 180), rng.randint(5, 12)), reverse=True):
            exp.slots.append(ExperienceSlot(starts_at=_at(today - timedelta(days=offset), times[0]), capacity=max_g))
        experiences.append(exp)
    db.add_all(experiences)
    db.flush()

    booked: dict[int, int] = {}  # slot id -> confirmed guests

    def room(slot: ExperienceSlot) -> int:
        return slot.capacity - booked.get(slot.id, 0)

    def book(slot: ExperienceSlot, guest: User, n: int, status: str = "confirmed",
             cancelled_by: str | None = None) -> ExperienceBooking:
        if status == "confirmed":
            n = min(n, room(slot))  # never overbook a slot
            booked[slot.id] = booked.get(slot.id, 0) + n
        price = calculate_experience_price(slot.experience.price_per_guest, n)
        b = ExperienceBooking(
            slot=slot, guest=guest, guests=n, price_per_guest=price.price_per_guest, subtotal=price.subtotal,
            service_fee=price.service_fee, taxes=price.taxes, total_price=price.total, status=status,
            cancelled_by=(cancelled_by or "guest") if status == "cancelled" else None,
            created_at=min(now, slot.starts_at - timedelta(days=rng.randint(2, 30))),
        )
        if status == "cancelled":
            b.cancelled_at = min(now, b.created_at + timedelta(days=1))
        db.add(b)
        return b

    reviewers = guests[2:] or guests
    for exp in experiences:
        past = [s for s in exp.slots if s.starts_at < now]
        future = [s for s in exp.slots if s.starts_at > now]
        for slot in past:
            guest = rng.choice(reviewers)
            b = book(slot, guest, min(rng.randint(1, 3), slot.capacity))
            rating, text = rng.choices(REVIEW_TEXT, weights=[{5: 8, 4: 2}[r] for r, _ in REVIEW_TEXT])[0]
            db.add(ExperienceReview(
                experience_id=exp.id, author=guest, booking=b, rating=rating, comment=text,
                created_at=slot.starts_at + timedelta(days=rng.randint(1, 4)),
            ))
        # partially (and occasionally fully) booked upcoming slots
        for slot in rng.sample(future, min(len(future), 6)):
            book(slot, rng.choice(reviewers), slot.capacity if rng.random() < 0.25 else min(2, slot.capacity))

    # Demo guest (Aarav): one upcoming, one completed-and-unreviewed, one cancelled
    aarav = guests[0]
    chai, food_tour = experiences[0], experiences[2]
    upcoming = next(s for s in chai.slots if s.starts_at > now + timedelta(days=3) and room(s) >= 2)
    book(upcoming, aarav, 2)
    done = min((s for s in food_tour.slots if s.starts_at < now - timedelta(days=2) and room(s) >= 2),
               key=lambda s: now - s.starts_at)
    book(done, aarav, 2)
    photo_service = next(e for e in experiences if e.kind == "service")
    later = next(s for s in photo_service.slots if s.starts_at > now + timedelta(days=10))
    book(later, aarav, 1, status="cancelled")
    # a host-side cancellation (Priya's private-chef dinner) for the "Cancelled by host" state
    chef = next(e for e in experiences if e.title.startswith("Private Chef"))
    chef_slot = next(s for s in chef.slots if s.starts_at > now + timedelta(days=6))
    book(chef_slot, aarav, 2, status="cancelled", cancelled_by="host")

    db.commit()
