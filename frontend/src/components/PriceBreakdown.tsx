import { formatPrice, plural } from "@/lib/format";
import type { Quote } from "@/lib/types";

export default function PriceBreakdown({ quote }: { quote: Quote }) {
  return (
    <div className="mt-6 space-y-3">
      <Row label={`${formatPrice(quote.nightly_rate)} x ${plural(quote.nights, "night")}`} value={quote.subtotal} />
      {quote.cleaning_fee > 0 && <Row label="Cleaning fee" value={quote.cleaning_fee} />}
      <Row label="Airbnb service fee" value={quote.service_fee} />
      <Row label="Taxes" value={quote.taxes} />
      <div className="flex justify-between border-t border-line pt-5 font-semibold">
        <span>Total</span>
        <span>{formatPrice(quote.total)}</span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="underline">{label}</span>
      <span>{formatPrice(value)}</span>
    </div>
  );
}
