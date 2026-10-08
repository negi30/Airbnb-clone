"""Price breakdown: nightly rate x nights + cleaning fee + service fee + taxes.

Kept in one pure function so the quote shown on the listing page and the amount
stored on the booking can never drift apart.
"""
from dataclasses import asdict, dataclass
from datetime import date

SERVICE_FEE_RATE = 0.14  # guest service fee, % of (nights subtotal)
TAX_RATE = 0.12  # taxes on (subtotal + cleaning + service)


@dataclass
class PriceBreakdown:
    nightly_rate: int
    nights: int
    subtotal: int
    cleaning_fee: int
    service_fee: int
    taxes: int
    total: int

    def as_dict(self) -> dict:
        return asdict(self)


def calculate_price(nightly_rate: int, cleaning_fee: int, check_in: date, check_out: date) -> PriceBreakdown:
    nights = (check_out - check_in).days
    if nights <= 0:
        raise ValueError("check_out must be after check_in")
    subtotal = nightly_rate * nights
    service_fee = round(subtotal * SERVICE_FEE_RATE)
    taxes = round((subtotal + cleaning_fee + service_fee) * TAX_RATE)
    return PriceBreakdown(
        nightly_rate=nightly_rate,
        nights=nights,
        subtotal=subtotal,
        cleaning_fee=cleaning_fee,
        service_fee=service_fee,
        taxes=taxes,
        total=subtotal + cleaning_fee + service_fee + taxes,
    )


@dataclass
class ExperiencePriceBreakdown:
    price_per_guest: int
    guests: int
    subtotal: int
    service_fee: int
    taxes: int
    total: int

    def as_dict(self) -> dict:
        return asdict(self)


def calculate_experience_price(price_per_guest: int, guests: int) -> ExperiencePriceBreakdown:
    """Per-guest price x guests, with the same service-fee and tax rates as stays."""
    if guests <= 0:
        raise ValueError("At least one guest is required")
    subtotal = price_per_guest * guests
    service_fee = round(subtotal * SERVICE_FEE_RATE)
    taxes = round((subtotal + service_fee) * TAX_RATE)
    return ExperiencePriceBreakdown(
        price_per_guest=price_per_guest,
        guests=guests,
        subtotal=subtotal,
        service_fee=service_fee,
        taxes=taxes,
        total=subtotal + service_fee + taxes,
    )
