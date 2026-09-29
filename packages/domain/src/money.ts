import { DomainError } from "./errors.js";

export type CurrencyCode = "USD" | "EUR" | "GBP";

export type Money = {
  cents: number;
  currency: CurrencyCode;
};

export function money(cents: number, currency: CurrencyCode = "USD"): Money {
  if (!Number.isInteger(cents)) {
    throw new DomainError("validation", "money.invalid", "Money amounts must be stored as integer cents.");
  }

  return { cents, currency };
}

export function addMoney(values: Money[]): Money {
  if (values.length === 0) {
    return money(0);
  }

  const currency = values[0].currency;
  const total = values.reduce((sum, value) => {
    assertSameCurrency(currency, value.currency);
    return sum + value.cents;
  }, 0);

  return money(total, currency);
}

export function multiplyMoney(value: Money, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new DomainError("validation", "money.invalid", "Quantity must be a non-negative integer.");
  }

  return money(value.cents * quantity, value.currency);
}

export function applyPercentageDiscount(value: Money, percentOff: number): Money {
  if (percentOff < 0 || percentOff > 100) {
    throw new DomainError("validation", "money.invalid", "Percent discount must be between 0 and 100.");
  }

  const discounted = Math.round(value.cents * (1 - percentOff / 100));
  return money(discounted, value.currency);
}

export function applyTax(value: Money, basisPoints: number): Money {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new DomainError("validation", "money.invalid", "Tax basis points must be a non-negative integer.");
  }

  const tax = Math.round(value.cents * (basisPoints / 10_000));
  return money(tax, value.currency);
}

export function formatMoney(value: Money): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: value.currency
  }).format(value.cents / 100);
}

function assertSameCurrency(expected: CurrencyCode, actual: CurrencyCode): void {
  if (expected !== actual) {
    throw new DomainError("validation", "money.invalid", `Currency mismatch: expected ${expected}, received ${actual}.`);
  }
}
