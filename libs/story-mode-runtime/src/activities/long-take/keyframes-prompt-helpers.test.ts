import { STYLE_REFERENCE_INSTRUCTION } from '@reelmakeeasy/common/long-take/style-reference'

import type { LongTakeAnchorMeta } from './anchor-meta'
import { buildLongTakeKeyframeShotInputs } from './keyframes-prompt-helpers'

const anchorLookup = new Map<string, LongTakeAnchorMeta>([
  ['hero', { uri: 'store://projects/p/long_take/anchors/hero.png' } as LongTakeAnchorMeta],
])

function build(opts: { styleReferenceUris?: string[]; usedAssetIds?: string[] }) {
  return buildLongTakeKeyframeShotInputs({
    anchorLookup,
    basePrompt: 'A hero walks into a sunny kitchen.',
    globalContext: null,
    improvedVisualScriptEnabled: false,
    styleText: 'Claymation, soft studio light',
    ...opts,
  })
}

const imageUrls = (parts: ReturnType<typeof build>['shotContents']) =>
  parts.flatMap((part) => (part.type === 'image_url' ? [part.imageUrl] : []))

describe('buildLongTakeKeyframeShotInputs style reference', () => {
  it('sends the style reference after the anchors, with its instruction', () => {
    const { shotContents } = build({
      styleReferenceUris: ['store://projects/p/long_take/style_reference/original.jpg'],
      usedAssetIds: ['hero'],
    })
    expect(imageUrls(shotContents)).toEqual([
      'store://projects/p/long_take/anchors/hero.png',
      'store://projects/p/long_take/style_reference/original.jpg',
    ])
    const instructionAt = shotContents.findIndex(
      (part) => part.type === 'text' && part.text === STYLE_REFERENCE_INSTRUCTION,
    )
    const referenceAt = shotContents.findIndex(
      (part) =>
        part.type === 'image_url' &&
        part.imageUrl === 'store://projects/p/long_take/style_reference/original.jpg',
    )
    expect(instructionAt).toBeGreaterThan(-1)
    expect(instructionAt).toBe(referenceAt - 1)
  })

  it('sends the style reference on shots without anchors', () => {
    const { shotContents } = build({ styleReferenceUris: ['store://ref.png'] })
    expect(imageUrls(shotContents)).toEqual(['store://ref.png'])
  })

  it('treats the shot as anchor-free when only a style reference is attached', () => {
    const withReference = build({ styleReferenceUris: ['store://ref.png'] })
    const without = build({})
    expect(withReference.promptPayload.prompt).toBe(without.promptPayload.prompt)
  })

  it('leaves the request unchanged without a style reference', () => {
    const { shotContents } = build({ usedAssetIds: ['hero'] })
    expect(imageUrls(shotContents)).toEqual(['store://projects/p/long_take/anchors/hero.png'])
    expect(
      shotContents.some(
        (part) => part.type === 'text' && part.text === STYLE_REFERENCE_INSTRUCTION,
      ),
    ).toBe(false)
  })
})
