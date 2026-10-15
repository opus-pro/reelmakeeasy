import { storeKeyToUrl, storeUri } from '../../storage/address'

export function getTemplatesCdnUrl(...args: string[]): string {
  return storeKeyToUrl(['atomic-templates', ...args].join('/'))
}
export function getTemplatesUri(...args: string[]): string {
  return storeUri(['atomic-templates', ...args].join('/'))
}
