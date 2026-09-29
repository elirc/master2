import { addMoney, applyPercentageDiscount, applyTax, money, multiplyMoney, type CurrencyCode, type Money } from "./money.js";

export type InvoiceInputLine = {
  description: string;
  unitAmountCents: number;
  quantity: number;
};

export type InvoiceCalculationInput = {
  currency: CurrencyCode;
  lines: InvoiceInputLine[];
  couponPercentOff?: number;
  taxBasisPoints?: number;
};

export type InvoiceCalculatedLine = InvoiceInputLine & {
  subtotal: Money;
};

export type InvoiceCalculation = {
  lines: InvoiceCalculatedLine[];
  subtotal: Money;
  discount: Money;
  tax: Money;
  total: Money;
};

export function calculateInvoice(input: InvoiceCalculationInput): InvoiceCalculation {
  const lines = input.lines.map((line) => ({
    ...line,
    subtotal: multiplyMoney(money(line.unitAmountCents, input.currency), line.quantity)
  }));

  const subtotal = addMoney(lines.map((line) => line.subtotal));
  const discountedSubtotal = input.couponPercentOff
    ? applyPercentageDiscount(subtotal, input.couponPercentOff)
    : subtotal;
  const discount = money(subtotal.cents - discountedSubtotal.cents, input.currency);
  const tax = applyTax(discountedSubtotal, input.taxBasisPoints ?? 0);
  const total = addMoney([discountedSubtotal, tax]);

  return {
    lines,
    subtotal,
    discount,
    tax,
    total
  };
}
