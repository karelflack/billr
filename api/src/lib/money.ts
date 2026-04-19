import Decimal from 'decimal.js';

// Configure Decimal.js for billing precision:
// - 20 significant digits (well above NUMERIC(12,4) storage)
// - ROUND_HALF_UP mirrors standard accounting rounding
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/**
 * Wraps a raw string or number in a Decimal for safe arithmetic.
 * Never pass native floats for money calculations — always go through this.
 */
export function toDecimal(val: string | number | Decimal): Decimal {
  return new Decimal(val);
}

/**
 * Formats a Decimal as a string with exactly 2 decimal places,
 * suitable for display to users (e.g., invoice totals).
 */
export function formatAmount(d: Decimal): string {
  return d.toFixed(2);
}

/**
 * Multiplies quantity by unit_amount and returns a Decimal rounded to 2dp.
 * Used when computing line item totals to match NUMERIC(12,2) storage.
 */
export function computeLineAmount(quantity: Decimal, unitAmount: Decimal): Decimal {
  return quantity.mul(unitAmount).toDecimalPlaces(2);
}

export { Decimal };
