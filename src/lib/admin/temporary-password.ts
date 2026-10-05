import { randomInt } from "node:crypto";

// No look-alikes (0/O, 1/l/I) so it can be read out loud or copied by hand.
const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const LOWER = "abcdefghjkmnpqrstuvwxyz";
const DIGITS = "23456789";
const ALPHABET = UPPER + LOWER + DIGITS;

/**
 * 20 characters from a 54-symbol alphabet (about 113 bits after the class
 * guarantee), grouped in fives with hyphens. Always contains an upper-case
 * letter, a lower-case letter and a digit, and the hyphens count as symbols,
 * so it satisfies the strictest password requirement a hosted project can
 * enable (Auth → Providers → Email: lower, upper, digits and symbols).
 */
export function temporaryPassword(length = 20): string {
  if (length < 3) throw new RangeError("temporaryPassword needs at least 3 characters");
  const chars = Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]);
  // One of each required class at distinct random positions.
  const positions = new Set<number>();
  while (positions.size < 3) positions.add(randomInt(length));
  const [upper, lower, digit] = [...positions];
  chars[upper] = UPPER[randomInt(UPPER.length)];
  chars[lower] = LOWER[randomInt(LOWER.length)];
  chars[digit] = DIGITS[randomInt(DIGITS.length)];
  return chars.join("").replace(/(.{5})(?!$)/g, "$1-");
}
