/**
 * Money is represented as an integer number of centavos (1/100 PHP).
 * NEVER use JavaScript floats for money math. This module is the only
 * place allowed to convert between display strings and integer centavos.
 *
 * Why integers: floats cannot exactly represent values like 0.1, which
 * causes silent rounding errors in financial software. Postgres NUMERIC
 * maps to this as a bigint/integer column (centavos), not a float/real column.
 */

export type Centavos = number & { readonly __brand: "Centavos" };

export function centavos(value: number): Centavos {
  if (!Number.isInteger(value)) {
    throw new MoneyError(
      `Centavos value must be an integer, got ${value}. Did you mean pesosToCentavos()?`
    );
  }
  return value as Centavos;
}

export class MoneyError extends Error {}

/** Parses a decimal peso string/number (e.g. "1234.56" or 1234.56) into integer centavos. */
export function pesosToCentavos(pesos: string | number): Centavos {
  const str = typeof pesos === "number" ? pesos.toString() : pesos.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(str)) {
    throw new MoneyError(`Invalid peso amount: "${pesos}"`);
  }
  const negative = str.startsWith("-");
  const unsigned = negative ? str.slice(1) : str;
  const [wholePart, fracPartRaw = ""] = unsigned.split(".");
  const fracPart = (fracPartRaw + "00").slice(0, 2);
  const total = parseInt(wholePart, 10) * 100 + parseInt(fracPart, 10);
  return centavos(negative ? -total : total);
}

/**
 * Like pesosToCentavos(), but for amounts that can never legitimately be
 * negative (a product's selling price or COGS, for example — unlike a
 * signed ledger entry, there's no valid "negative price"). Also rejects
 * zero selling prices, since a ₱0 selling price on a real product is
 * almost always a typo, not an intentional giveaway item.
 */
export function pesosToPositiveCentavos(pesos: string | number, label: string): Centavos {
  const value = pesosToCentavos(pesos);
  if (value <= 0) {
    throw new MoneyError(`${label} must be greater than ₱0, got ${centavosToPesos(value)}`);
  }
  return value;
}

/** Same as pesosToPositiveCentavos(), but 0 is allowed (e.g. COGS can legitimately be ₱0). */
export function pesosToNonNegativeCentavos(pesos: string | number, label: string): Centavos {
  const value = pesosToCentavos(pesos);
  if (value < 0) {
    throw new MoneyError(`${label} cannot be negative, got ${centavosToPesos(value)}`);
  }
  return value;
}

export function centavosToPesos(c: Centavos): number {
  return c / 100;
}

/** Formats centavos as a PHP currency display string, e.g. "₱1,234.56". */
export function formatPHP(c: Centavos): string {
  const pesos = c / 100;
  return pesos.toLocaleString("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  });
}

export function add(...values: Centavos[]): Centavos {
  return centavos(values.reduce((sum, v) => sum + v, 0));
}

export function subtract(a: Centavos, b: Centavos): Centavos {
  return centavos(a - b);
}

export function multiplyByQuantity(unit: Centavos, quantity: number): Centavos {
  if (!Number.isInteger(quantity)) {
    throw new MoneyError(`Quantity must be an integer, got ${quantity}`);
  }
  return centavos(unit * quantity);
}

/**
 * Defense-in-depth for values that have already been converted to Centavos
 * upstream (e.g. by a Zod schema) but reach a function whose logic silently
 * assumes a positive magnitude — such as recordQuickExpense() negating this
 * value for the ledger. If that upstream guarantee is ever weakened or
 * bypassed, this is the last check before the sign gets flipped.
 */
export function assertPositiveCentavos(c: Centavos, label: string): void {
  if (c <= 0) {
    throw new MoneyError(`${label} must be a positive amount, got ${centavosToPesos(c)}`);
  }
}

export const ZERO: Centavos = centavos(0);

export function isNegative(c: Centavos): boolean {
  return c < 0;
}

export function max(a: Centavos, b: Centavos): Centavos {
  return a > b ? a : b;
}

export function clampToZero(c: Centavos): Centavos {
  return max(c, ZERO);
}
