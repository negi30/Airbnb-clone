"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, isNightBooked, nextBlockedDate, parseISODate, toISODate, todayISO } from "@/lib/format";

/** Longest stay the API accepts (MAX_NIGHTS in backend/app/services/availability.py). */
export const MAX_NIGHTS = 90;
import type { DateRange } from "@/lib/types";

interface Props {
  checkIn: string | null;
  checkOut: string | null;
  onChange: (checkIn: string | null, checkOut: string | null) => void;
  bookedRanges?: DateRange[];
  months?: 1 | 2;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * Airbnb-style two-month range picker.
 * - Nights already booked can't be picked as check-in.
 * - After choosing check-in, any checkout past the next booked night is disabled,
 *   so the selected range can never overlap an existing booking.
 * - A booked range's checkout day stays selectable (same-day turnover).
 */
export default function DateRangeCalendar({ checkIn, checkOut, onChange, bookedRanges = [], months = 2 }: Props) {
  const today = todayISO();
  const [view, setView] = useState(() => {
    const base = checkIn ? parseISODate(checkIn) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const selectingCheckout = Boolean(checkIn && !checkOut);
  const limit = useMemo(
    () => (selectingCheckout && checkIn ? nextBlockedDate(checkIn, bookedRanges) : null),
    [selectingCheckout, checkIn, bookedRanges],
  );

  function isDisabled(day: string) {
    if (day < today) return true;
    if (selectingCheckout && checkIn) {
      if (day <= checkIn) return isNightBooked(day, bookedRanges); // allow restarting selection earlier
      return (limit !== null && day > limit) || day > addDays(checkIn, MAX_NIGHTS);
    }
    return isNightBooked(day, bookedRanges);
  }

  function handleClick(day: string) {
    if (isDisabled(day)) return;
    if (!checkIn || checkOut || day <= checkIn) {
      onChange(day, null);
    } else {
      onChange(checkIn, day);
    }
  }

  const monthList = Array.from({ length: months }, (_, i) => new Date(view.getFullYear(), view.getMonth() + i, 1));
  const canGoBack = view > new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  return (
    <div className="select-none">
      <div className="relative flex gap-10">
        <button
          type="button"
          aria-label="Previous month"
          disabled={!canGoBack}
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
          className="absolute left-0 top-0 rounded-full p-1.5 hover:bg-gray-100 disabled:opacity-25"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
          className="absolute right-0 top-0 rounded-full p-1.5 hover:bg-gray-100"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        {monthList.map((month) => {
          const first = month.getDay();
          const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
          const cells: (string | null)[] = [
            ...Array(first).fill(null),
            ...Array.from({ length: daysInMonth }, (_, i) =>
              toISODate(new Date(month.getFullYear(), month.getMonth(), i + 1)),
            ),
          ];
          return (
            <div key={month.toISOString()} className="flex-1">
              <h3 className="mb-4 text-center text-base font-semibold">
                {month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </h3>
              <div className="grid grid-cols-7 text-center text-xs font-semibold text-muted">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="pb-2">
                    {w}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {cells.map((day, i) => {
                  if (!day) return <div key={`b${i}`} className="h-11" />;
                  const disabled = isDisabled(day);
                  const isStart = day === checkIn;
                  const isEnd = day === checkOut;
                  const inRange = Boolean(checkIn && checkOut && day > checkIn && day < checkOut);
                  return (
                    <div
                      key={day}
                      className={`relative h-11 ${inRange ? "bg-soft" : ""} ${
                        isStart && checkOut ? "bg-gradient-to-r from-transparent from-50% to-soft to-50%" : ""
                      } ${isEnd && checkIn ? "bg-gradient-to-l from-transparent from-50% to-soft to-50%" : ""}`}
                    >
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleClick(day)}
                        className={`mx-auto flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold transition ${
                          isStart || isEnd
                            ? "bg-ink text-white"
                            : disabled
                              ? "cursor-not-allowed text-gray-300 line-through"
                              : "hover:border hover:border-ink"
                        }`}
                      >
                        {parseISODate(day).getDate()}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
