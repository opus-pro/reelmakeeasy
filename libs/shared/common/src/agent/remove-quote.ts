export function removeHeadingEndingQuotes(text: string) {
  // remove only when has heading and ending quotes
  if (text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1)
  }
  if (text.startsWith('“') && text.endsWith('”')) {
    return text.slice(1, -1)
  }
  return text
}
