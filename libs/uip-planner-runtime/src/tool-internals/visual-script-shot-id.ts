export function normalizeVisualShotId(rawShotId: string | undefined, index: number): string {
  const normalized = rawShotId?.trim() ?? ''
  const shotMatch = normalized.match(/^shot_(\d+)(?:\D.*)?$/i)
  if (shotMatch) {
    return `shot_${Number.parseInt(shotMatch[1], 10)}`
  }

  const shortMatch = normalized.match(/^s(\d+)$/i)
  if (shortMatch) {
    return `shot_${Number.parseInt(shortMatch[1], 10)}`
  }

  return `shot_${index + 1}`
}
