export interface Seedance25IdentityBinding {
  appearance: string
  assetId: string
  role: string
}

export function appendSeedance25IdentityBindings(params: {
  bindings: Seedance25IdentityBinding[]
  prompt: string
  startImageIndex: number
}): string {
  if (params.bindings.length === 0) {
    return params.prompt
  }
  const lines = [
    'Identity reference bindings (mandatory and one-to-one):',
    ...params.bindings.map(
      (binding, index) =>
        `- @Image${params.startImageIndex + index} -> asset_id="${sanitizeBindingValue(binding.assetId)}" -> role="${sanitizeBindingValue(binding.role)}" -> appearance="${sanitizeBindingValue(binding.appearance)}". Preserve this exact mapping; do not transfer the role or appearance to another reference.`,
    ),
  ]
  return [params.prompt, lines.join('\n')].filter(Boolean).join('\n\n')
}

export function appendTransitionIdentityBindings(params: {
  bindings: Seedance25IdentityBinding[]
  prompt: string
}): string {
  if (params.bindings.length === 0) {
    return params.prompt
  }
  const lines = [
    'Character identity bindings (mandatory and one-to-one):',
    ...params.bindings.map(
      (binding) =>
        `- asset_id="${sanitizeBindingValue(binding.assetId)}" -> role="${sanitizeBindingValue(binding.role)}" -> appearance="${sanitizeBindingValue(binding.appearance)}". Preserve this exact mapping; do not transfer the role or appearance to another character.`,
    ),
  ]
  return [lines.join('\n'), params.prompt].filter(Boolean).join('\n\n')
}

function sanitizeBindingValue(value: string): string {
  return value.replaceAll('"', "'").replace(/\s+/g, ' ').trim()
}
