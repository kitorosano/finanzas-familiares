export function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

export function isPositiveFiniteNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
