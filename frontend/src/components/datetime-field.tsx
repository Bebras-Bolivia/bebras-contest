"use client";

import { useEffect, useState, type KeyboardEvent, type Ref } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toDatetimeLocalValue } from "@/lib/contest-schema";
import { cn } from "@/lib/utils";

const fieldClass =
  "h-10 border-2 border-border/20 bg-background px-3 text-sm transition-colors outline-none hover:border-border/40 focus-visible:border-primary disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive";

export function parseDateTimeLocal(value: string) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function toTimeValue(value: string) {
  const date = parseDateTimeLocal(value);

  if (!date) {
    return "";
  }

  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseTimeInput(text: string) {
  const clean = text
    .trim()
    .toLowerCase()
    .replace(/[\s.]/g, "")
    .replace(/(h|hrs?)$/, "");
  const withSeparator = clean.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
  const digitsOnly = clean.match(/^\d{3,4}$/);
  let hours: number;
  let minutes: number;

  if (withSeparator) {
    hours = Number(withSeparator[1]);
    minutes = Number(withSeparator[2] ?? 0);
  } else if (digitsOnly) {
    const digits = clean.padStart(4, "0");
    hours = Number(digits.slice(0, 2));
    minutes = Number(digits.slice(2));
  } else {
    return null;
  }

  if (hours > 23 || minutes > 59) {
    return null;
  }

  return `${pad(hours)}:${pad(minutes)}`;
}

function withDate(
  currentValue: string,
  nextDate: Date,
  fallbackHour: number,
  minDate: Date | null,
  maxDate: Date | null,
) {
  const currentDate = parseDateTimeLocal(currentValue);
  const nextValue = new Date(nextDate);

  if (currentDate) {
    nextValue.setHours(currentDate.getHours(), currentDate.getMinutes(), 0, 0);
  } else {
    nextValue.setHours(fallbackHour, 0, 0, 0);
  }

  if (minDate && isSameDay(nextValue, minDate) && nextValue < minDate) {
    nextValue.setHours(minDate.getHours(), minDate.getMinutes(), 0, 0);
  }
  if (maxDate && isSameDay(nextValue, maxDate) && nextValue > maxDate) {
    nextValue.setHours(maxDate.getHours(), maxDate.getMinutes(), 0, 0);
  }

  return toDatetimeLocalValue(nextValue.toISOString());
}

function withTime(currentValue: string, nextTime: string) {
  const currentDate = parseDateTimeLocal(currentValue) ?? new Date();
  const [hours, minutes] = nextTime.split(":").map((part) => Number(part));

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return currentValue;
  }

  const nextValue = new Date(currentDate);
  nextValue.setHours(hours, minutes, 0, 0);
  return toDatetimeLocalValue(nextValue.toISOString());
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function TimeField({
  id,
  label,
  value,
  min,
  max,
  disabled,
  invalid,
  describedBy,
  onCommit,
}: {
  id?: string;
  label: string;
  value: string;
  min?: string;
  max?: string;
  disabled: boolean;
  invalid: boolean;
  describedBy?: string;
  onCommit: (time: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const parsed = parseTimeInput(draft);
    if (!parsed) {
      setDraft(value);
      return;
    }
    const next = min && parsed < min ? min : max && parsed > max ? max : parsed;
    setDraft(next);
    if (next !== value) onCommit(next);
  };

  return (
    <input
      id={id}
      aria-label={label}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      autoComplete="off"
      inputMode="numeric"
      placeholder="HH:MM"
      className={cn(
        fieldClass,
        "w-24 shrink-0 tabular-nums placeholder:text-muted-foreground",
      )}
      disabled={disabled}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
      onBlur={commit}
    />
  );
}

export function DateTimeField({
  id,
  value,
  onChange,
  label,
  minDate = null,
  maxDate = null,
  fallbackHour = 8,
  disabled = false,
  invalid = false,
  describedBy,
  dateRef,
}: {
  id?: string;
  value: string;
  onChange: (nextValue: string) => void;
  label: string;
  minDate?: Date | null;
  maxDate?: Date | null;
  fallbackHour?: number;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  dateRef?: Ref<HTMLButtonElement>;
}) {
  const date = parseDateTimeLocal(value);
  const dateLabel = date
    ? format(date, "d MMM yyyy", { locale: es })
    : "Elige un día";

  const timeMin =
    date && minDate && isSameDay(date, minDate)
      ? toTimeValue(minDate.toISOString())
      : undefined;
  const timeMax =
    date && maxDate && isSameDay(date, maxDate)
      ? toTimeValue(maxDate.toISOString())
      : undefined;

  return (
    <div className="flex min-w-0 gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            ref={dateRef}
            id={id}
            type="button"
            disabled={disabled}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            aria-label={`${label}, día`}
            className={cn(
              fieldClass,
              "flex min-w-0 flex-1 items-center gap-2 text-left",
              !date && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="size-4 shrink-0" />
            {dateLabel}
          </button>
        </PopoverTrigger>
        <PopoverContent
          data-calendar-popover
          className="w-auto rounded-sm p-0"
          align="start"
        >
          <Calendar
            initialFocus
            mode="single"
            selected={date ?? undefined}
            defaultMonth={date ?? minDate ?? undefined}
            disabled={[
              ...(minDate ? [{ before: minDate }] : []),
              ...(maxDate ? [{ after: maxDate }] : []),
            ]}
            onSelect={(nextDate) => {
              if (nextDate) {
                onChange(
                  withDate(value, nextDate, fallbackHour, minDate, maxDate),
                );
              }
            }}
          />
        </PopoverContent>
      </Popover>
      <TimeField
        id={id ? `${id}-time` : undefined}
        label={`${label}, hora`}
        value={toTimeValue(value)}
        min={timeMin}
        max={timeMax}
        disabled={disabled || !date}
        invalid={invalid}
        describedBy={describedBy}
        onCommit={(time) => onChange(withTime(value, time))}
      />
    </div>
  );
}
