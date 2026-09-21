import type { Money } from "./types";

export function money(amountMinor: number, currency: string): Money {
  const normalizedCurrency = currency.trim().toUpperCase();

  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
    throw new Error("Currency must be an ISO 4217-style 3-letter code");
  }

  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error("Money amount must be a non-negative integer minor-unit value");
  }

  return { amountMinor, currency: normalizedCurrency };
}

export function gbp(amountMinor: number): Money {
  return money(amountMinor, "GBP");
}

export function parseGbpPrice(value: string | number | null | undefined): Money | null {
  return parsePrice(value, "GBP");
}

export function parsePrice(
  value: string | number | null | undefined,
  fallbackCurrency = "GBP",
): Money | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }

    return money(Math.round(value * 100), fallbackCurrency);
  }

  if (!value) {
    return null;
  }

  const normalised = value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (/(?:^|\s)-\s*(?:£|\$|€|GBP|USD|EUR|\d)/i.test(normalised)) {
    return null;
  }

  const decoratedMatch = normalised.match(
    /(?:£|\$|€|GBP|USD|EUR)\s*([0-9][0-9.,\s]*)|([0-9][0-9.,\s]*)\s*(?:£|\$|€|GBP|USD|EUR)/i,
  );
  const bareMatch = normalised.match(/^([0-9][0-9.,\s]*)$/);
  const rawNumber = (decoratedMatch?.[1] ?? decoratedMatch?.[2] ?? bareMatch?.[1])?.trim();

  if (!rawNumber) {
    return null;
  }
  const amount = parseLocalizedAmount(rawNumber);
  if (amount === null) {
    return null;
  }
  return money(Math.round(amount * 100), inferCurrency(normalised, fallbackCurrency));
}

function parseLocalizedAmount(raw: string): number | null {
  const compact = raw.replace(/\s/g, "");
  if (!/^\d[\d.,]*$/.test(compact)) return null;

  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  let decimalSeparator = "";
  if (lastComma >= 0 && lastDot >= 0) {
    decimalSeparator = lastComma > lastDot ? "," : ".";
  } else {
    const separator = lastComma >= 0 ? "," : lastDot >= 0 ? "." : "";
    if (separator) {
      const digitsAfter = compact.length - compact.lastIndexOf(separator) - 1;
      if (digitsAfter === 1 || digitsAfter === 2) decimalSeparator = separator;
    }
  }

  let normalized = compact;
  if (decimalSeparator) {
    const decimalIndex = compact.lastIndexOf(decimalSeparator);
    normalized = `${compact.slice(0, decimalIndex).replace(/[.,]/g, "")}.${compact.slice(decimalIndex + 1)}`;
  } else {
    normalized = compact.replace(/[.,]/g, "");
  }
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);

  return money(left.amountMinor - right.amountMinor, left.currency);
}

export function isLessThan(left: Money, right: Money): boolean {
  assertSameCurrency(left, right);

  return left.amountMinor < right.amountMinor;
}

export function formatMoney(value: Money): string {
  const pounds = value.amountMinor / 100;

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: value.currency,
    maximumFractionDigits: Number.isInteger(pounds) ? 0 : 2,
  }).format(pounds);
}

function inferCurrency(value: string, fallbackCurrency: string): string {
  if (value.includes("£") || /\bGBP\b/i.test(value)) {
    return "GBP";
  }

  if (value.includes("$") || /\bUSD\b/i.test(value)) {
    return "USD";
  }

  if (value.includes("€") || /\bEUR\b/i.test(value)) {
    return "EUR";
  }

  return fallbackCurrency;
}

function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    throw new Error(`Currency mismatch: ${left.currency} and ${right.currency}`);
  }
}
