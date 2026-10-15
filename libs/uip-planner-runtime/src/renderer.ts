import { normalizeStyleInstruction } from '@reelmakeeasy/common/uip/normalization'

import { GlobalConstraints, Meta, OpenQuestion, Shot, Spec, VisualScript } from './types'

export interface RenderPlanMdOptions {
  changedShots?: ShotChangeMap
  lastDiffSummary?: string
  lockNoteOverride?: string
}
export type ShotChangedField = 'assets' | 'audio_vo' | 'shot' | 'time' | 'visual_plan'

export type ShotChangeMap = Map<string, Set<ShotChangedField>>

export function computeChangedShotFields(prevSpec: Spec, nextSpec: Spec): ShotChangeMap {
  if (prevSpec.visual_script.shots.length === 0) {
    return new Map()
  }

  const changed: ShotChangeMap = new Map()
  const prevMap = new Map(prevSpec.visual_script.shots.map((s) => [s.shot_id, s]))
  const nextMap = new Map(nextSpec.visual_script.shots.map((s) => [s.shot_id, s]))

  for (const [shot_id, nextShot] of nextMap) {
    const prevShot = prevMap.get(shot_id)
    const fields = new Set<ShotChangedField>()

    if (!prevShot) {
      fields.add('shot')
      changed.set(shot_id, fields)
      continue
    }

    if (prevShot.order !== nextShot.order) {
      fields.add('shot')
    }

    if (prevShot.audio_vo !== nextShot.audio_vo) {
      fields.add('audio_vo')
    }

    if (
      prevShot.time.start_s !== nextShot.time.start_s ||
      prevShot.time.end_s !== nextShot.time.end_s
    ) {
      fields.add('time')
    }

    if (
      prevShot.visual_primary.core_description !== nextShot.visual_primary.core_description ||
      prevShot.visual_primary.entry_action !== nextShot.visual_primary.entry_action ||
      prevShot.visual_primary.exit_action !== nextShot.visual_primary.exit_action ||
      prevShot.visual_primary.expression_type !== nextShot.visual_primary.expression_type ||
      prevShot.visual_primary.aesthetic_mode !== nextShot.visual_primary.aesthetic_mode ||
      prevShot.visual_primary.availability !== nextShot.visual_primary.availability ||
      JSON.stringify(prevShot.visual_primary.notes ?? []) !==
        JSON.stringify(nextShot.visual_primary.notes ?? [])
    ) {
      fields.add('visual_plan')
    }

    if (hasAssetAddOrRemove(prevShot, nextShot)) {
      fields.add('assets')
    }

    if (fields.size > 0) {
      changed.set(shot_id, fields)
    }
  }

  return changed
}

export function renderPlanMd(spec: Spec, options: RenderPlanMdOptions = {}): string {
  const { global_constraints: gc, visual_script: vs, meta } = spec
  const sections: string[] = []

  const { title, lockNote } = renderTitle(meta, options.lockNoteOverride)
  sections.push(title)

  if (options.lastDiffSummary) {
    sections.push(`**Diff**: ${options.lastDiffSummary}`)
  }

  const toAdd: string[] = [
    renderGlobalConstraints(gc),
    renderVisualScript(vs, options.changedShots),
  ]

  const questionsSection = renderOpenQuestions(meta.open_questions)
  if (questionsSection) {
    toAdd.push(questionsSection)
  }

  if (lockNote) {
    toAdd.push(lockNote)
  }

  sections.push(...toAdd)

  return sections.join('\n\n')
}

function escapeMd(text: string): string {
  const flattened = text
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return flattened.replace(/\|/g, String.raw`\|`)
}

function hasAssetAddOrRemove(prevShot: Shot, nextShot: Shot): boolean {
  const prevIds = prevShot.pre_selected_assets
    .map((asset) => asset.asset_id)
    .slice()
    .sort()
  const nextIds = nextShot.pre_selected_assets
    .map((asset) => asset.asset_id)
    .slice()
    .sort()
  return JSON.stringify(prevIds) !== JSON.stringify(nextIds)
}

function renderGlobalConstraints(gc: GlobalConstraints): string {
  const gcLines: string[] = ['## Global Constraints']
  const styleLabel = normalizeStyleInstruction(gc.style) || '_not set_'

  gcLines.push(
    `- **Topic**: ${gc.topic || '_not set_'}`,
    `- **Video Type**: ${gc.video_type || '_not set_'}`,
    `- **Audience**: ${gc.target_audience || '_not set_'}`,
    `- **Tone**: ${gc.tone || '_not set_'}`,
    `- **Style**: ${styleLabel}`,
    `- **Pacing**: ${gc.pacing || '_not set_'}`,
  )

  if (gc.must_not_violate.length > 0) {
    gcLines.push('- **Must Not Violate**:')
    for (const constraint of gc.must_not_violate) {
      gcLines.push(`  - ${constraint}`)
    }
  }

  return gcLines.join('\n')
}

function renderOpenQuestions(openQs: OpenQuestion[]): null | string {
  if (openQs.length === 0) {
    return null
  }

  const qLines: string[] = ['## Open Questions']
  for (const q of openQs) {
    const tag = q.blocking ? '**[BLOCKING]** ' : ''
    const paths =
      q.missing_paths.length > 0 ? ` *(Missing: \`${q.missing_paths.join('`, `')}\`)*` : ''
    qLines.push(`- ❓ ${tag}${q.question}${paths}`)
  }
  return qLines.join('\n')
}

function renderShotRow(shot: Shot, changedShots?: ShotChangeMap): string {
  const changedFields = changedShots?.get(shot.shot_id)
  const has = (field: ShotChangedField): boolean => Boolean(changedFields?.has(field))
  const rowUpdatedByOrderChange = has('shot')
  const marker = (field: ShotChangedField): string =>
    rowUpdatedByOrderChange || has(field) ? '**[UPDATED]** ' : ''

  const shotRef = `${marker('shot')}#${shot.order} (${shot.shot_id})`
  const timeRange = `${shot.time.start_s.toFixed(2)}–${shot.time.end_s.toFixed(2)}`
  const time = `${marker('time')}${timeRange}`
  const vo = `${marker('audio_vo')}${escapeMd(shot.audio_vo)}`
  const visual = `${marker('visual_plan')}${escapeMd(shot.visual_primary.core_description)}`

  const assetsValue =
    shot.pre_selected_assets.length > 0
      ? shot.pre_selected_assets.map((a) => a.asset_id).join(', ')
      : '—'
  const assets = `${marker('assets')}${assetsValue}`

  return `| ${shotRef} | ${time} | ${vo} | ${visual} | ${assets} |`
}

function renderTitle(meta: Meta, lockNoteOverride?: string): { lockNote: string; title: string } {
  let lockNote = ''
  if (meta.locked_at) {
    if (lockNoteOverride === undefined) {
      lockNote = '\n\n*Plan locked*'
    } else {
      lockNote = `\n\n*Plan locked: ${lockNoteOverride}*`
    }
  }
  const title = meta.locked_at
    ? `# Video Plan v${meta.spec_version} — LOCKED`
    : `# Video Plan v${meta.spec_version}`
  return { title, lockNote }
}

function renderVisualScript(vs: VisualScript, changedShots?: ShotChangeMap): string {
  if (vs.shots.length === 0) {
    return '## Visual Script\n\n_No shots planned yet._'
  }

  const tableLines: string[] = [
    '## Visual Script',
    '',
    '| Shot | Time (s) | Voice Over | Visual Plan | Pre-selected Assets |',
    '|---|---|---|---|---|',
  ]

  const sortedShots = [...vs.shots].sort((a, b) => a.order - b.order)

  for (const shot of sortedShots) {
    tableLines.push(renderShotRow(shot, changedShots))
  }

  return tableLines.join('\n')
}
