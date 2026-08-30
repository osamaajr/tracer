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

  const symbolOrCodeMatch = normalised.match(
    /(?:£|\$|€|GBP|USD|EUR)\s*([0-9]+(?:,[0-9]{3})*|[0-9]+)(?:\.([0-9]{1,2}))?/i,
  );
  const bareMatch = normalised.match(
    /^([0-9]+(?:,[0-9]{3})*|[0-9]+)(?:\.([0-9]{1,2}))?$/,
  );
  const match = symbolOrCodeMatch ?? bareMatch;

  if (!match?.[1]) {
    return null;
  }

  const pounds = Number.parseInt(match[1].replace(/,/g, ""), 10);
  const pence = Number.parseInt((match[2] ?? "0").padEnd(2, "0"), 10);

  if (!Number.isFinite(pounds) || !Number.isFinite(pence)) {
    return null;
  }

  return money(pounds * 100 + pence, inferCurrency(normalised, fallbackCurrency));
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
