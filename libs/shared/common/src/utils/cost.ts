export function nanoDollar(usd: number, denom: number): number {
  return Math.round((usd * 1_000_000_000) / denom)
}
