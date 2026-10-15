import Mustache from 'mustache'
import proxyData from 'mustache-validator'

/**
 * Render a prompt filling placeholders with data.
 */
export function renderPrompt(template: string, data: Record<string, string>): string {
  return Mustache.render(template, proxyData(data))
}
