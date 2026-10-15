// RFC 2822 standard email validation
const MAIL_REG_EXP =
  /[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/

export function isDemoProjectId(projectId?: string): boolean {
  return projectId?.startsWith('demo-') ?? false
}
export function isValidEmail(email: string): boolean {
  return MAIL_REG_EXP.test(email.toLowerCase())
}

const URL_PROTOCOL_REG_EXP = /^https?:\/\//i

export function normalizeUserUrl(input: string): null | string {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }
  try {
    const parsed = new URL(URL_PROTOCOL_REG_EXP.test(trimmed) ? trimmed : `https://${trimmed}`)
    if (!parsed.hostname.includes('.')) {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}
