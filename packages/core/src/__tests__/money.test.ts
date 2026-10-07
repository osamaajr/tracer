import { afterEach, describe, expect, it, vi } from "vitest";
import { formatMoney } from "../domain/money";

const referenceFormat = (amountMinor: number, currency: string) => new Intl.NumberFormat("en-GB", {
  style: "currency", currency,
  maximumFractionDigits: Number.isInteger(amountMinor / 100) ? 0 : 2,
}).format(amountMinor / 100);

afterEach(() => vi.restoreAllMocks());

describe("currency formatting", () => {
  it("preserves native output for every supported currency, integer/fractional prices and cache eviction", () => {
    for (let pass = 0; pass < 2; pass++) {
      for (const currency of Intl.supportedValuesOf("currency")) {
        for (const amountMinor of [0, 100, 101, 34999, 100000000]) {
          expect(formatMoney({amountMinor, currency})).toBe(referenceFormat(amountMinor, currency));
        }
      }
    }
  });

  it("preserves currency casing, exceptional inputs and invalid-currency errors", () => {
    for (const currency of ["gbp", "USD", "XXX", "JPY", "KWD"]) {
      for (const amountMinor of [100, 101, -101, NaN, Infinity]) {
        expect(formatMoney({amountMinor, currency})).toBe(referenceFormat(amountMinor, currency));
      }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(() => formatMoney({amountMinor:100, currency:"invalid"})).toThrow(RangeError);
    }
  });

  it("reuses formatters for repeated prices while allowing evicted currencies to be used again", async () => {
    vi.resetModules();
    const {formatMoney: freshFormatMoney} = await import("../domain/money");
    const OriginalNumberFormat = Intl.NumberFormat;
    const construct = vi.spyOn(Intl, "NumberFormat").mockImplementation(function(locales, options) {
      return new OriginalNumberFormat(locales, options);
    });
    for (let i = 0; i < 100; i++) {
      freshFormatMoney({amountMinor:100, currency:"GBP"});
      freshFormatMoney({amountMinor:101, currency:"GBP"});
    }
    expect(construct).toHaveBeenCalledTimes(2);
    for (const currency of Intl.supportedValuesOf("currency").slice(0,40)) {
      freshFormatMoney({amountMinor:101, currency});
    }
    const before = construct.mock.calls.length;
    expect(freshFormatMoney({amountMinor:101, currency:"GBP"})).toBe("£1.01");
    expect(construct.mock.calls.length).toBe(before + 1);
  });
});
