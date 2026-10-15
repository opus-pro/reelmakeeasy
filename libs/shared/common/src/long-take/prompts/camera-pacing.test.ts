import { buildLongTakeBeatSheetExpertPrompt } from './long-take-beat-sheet-expert-prompt'
import { buildLongTakeVisualScriptPrompt } from './long-take-visual-script-prompt'

const beatSheet = (cameraStyle?: 'calm' | 'dynamic') =>
  buildLongTakeBeatSheetExpertPrompt({ cameraStyle, timestampedTranscript: '[0.0-1.0] Hello.' })

const visualScript = (cameraStyle?: 'calm' | 'dynamic') =>
  buildLongTakeVisualScriptPrompt({
    assetManifest: { asset_manifest: [] } as never,
    beatSheet: { beat_sheet: [] } as never,
    cameraStyle,
    globalConstraints: {},
    script: 'Hello.',
    userAssetContent: {
      characters: [],
      files: [],
      mandatory_user_upload_bindings: [],
      objects: [],
    } as never,
    worldBible: {} as never,
  })

describe('shot pacing by camera style', () => {
  it('keeps the beat sheet at 5-8s for calm or no style, and 3-6s for dynamic', () => {
    expect(beatSheet()).toBe(beatSheet('calm'))
    expect(beatSheet('calm')).toContain('prefer 5-8s for most shots')
    expect(beatSheet('dynamic')).toContain('prefer 3-6s for most shots')
    expect(beatSheet('dynamic')).not.toContain('5-8s')
    expect(beatSheet('dynamic')).toContain('[2s, 10s]')
  })

  it('keeps the visual script at 5-8s for calm or no style, and 3-6s for dynamic', () => {
    expect(visualScript()).toBe(visualScript('calm'))
    expect(visualScript('calm')).toContain('with 5-8 seconds as the preferred rhythm')
    expect(visualScript('dynamic')).toContain('with 3-6 seconds as the preferred rhythm')
    expect(visualScript('dynamic')).toContain('Medium shots (3-6s)')
    expect(visualScript('dynamic')).not.toContain('Use sparingly')
  })
})
