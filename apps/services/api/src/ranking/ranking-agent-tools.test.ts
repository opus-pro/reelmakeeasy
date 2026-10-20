import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { newRankingProject } from '@reelmakeeasy/common/ranking/ranking-project'

import { RankingAgentTools } from './ranking-agent-tools'

function tools() {
  const project = newRankingProject('11111111-1111-1111-1111-111111111111', 'now')
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-'))
  const ranking = {
    create: jest.fn(() => project),
    get: jest.fn(() => project),
    list: jest.fn(() => []),
    setClip: jest.fn(async () => project),
    addStickerImage: jest.fn(async () => ({ imageUrl: `store://ranking/${project.id}/stickers/x.png` })),
    update: jest.fn((_id: string, patch: unknown) => ({ ...project, ...(patch as object) })),
  }
  const t = new RankingAgentTools({
    ranking: ranking as never,
    sounds: { list: () => [] },
    workingDir: () => work,
  })
  return { project, ranking, t, work }
}

describe('RankingAgentTools', () => {
  it('applies a JSON patch and answers the project with what still stops its export', async () => {
    const { ranking, t } = tools()
    const r = await t.call('s', 'ranking_update', { id: 'p', patch: '{"name":"Cat fails"}' })
    expect(ranking.update).toHaveBeenCalledWith('p', { name: 'Cat fails' })
    expect(r.success).toBe(true)
    expect(r.text).toContain('Before export: Add a clip to rank')
    expect((await t.call('s', 'ranking_update', { id: 'p', patch: '{nope' })).success).toBe(false)
  })

  it('only takes clips from the chat’s working folder', async () => {
    const { ranking, t, work } = tools()
    expect((await t.call('s', 'ranking_add_clip', { id: 'p', path: '../../etc/hosts', rank: 1 })).text).toMatch(
      /working folder/,
    )
    expect((await t.call('s', 'ranking_add_clip', { id: 'p', path: 'a.mp4', rank: 9 })).text).toMatch(/no rank 9/)
    expect(ranking.setClip).not.toHaveBeenCalled()
    fs.mkdirSync(path.join(work, 'attachments'))
    fs.writeFileSync(path.join(work, 'attachments', 'cat.mp4'), 'x')
    expect((await t.call('s', 'ranking_add_clip', { id: 'p', path: 'missing.mp4', rank: 1 })).text).toMatch(/No file/)
  })

  it('stores a picture from the working folder for an image sticker', async () => {
    const { project, ranking, t, work } = tools()
    fs.writeFileSync(path.join(work, 'logo.png'), 'png')
    jest.spyOn(require('@reelmakeeasy/common/storage/file-store').fileStore, 'upload').mockResolvedValue(undefined)
    const r = await t.call('s', 'ranking_add_sticker_image', { id: 'p', path: 'logo.png' })
    expect(r.success).toBe(true)
    expect(r.text).toContain(`store://ranking/${project.id}/stickers/x.png`)
    expect(ranking.addStickerImage).toHaveBeenCalledWith('p', expect.stringMatching(/^store:\/\/tmp\/agent-ranking\//), 'logo.png')
    expect((await t.call('s', 'ranking_add_sticker_image', { id: 'p', path: '/etc/hosts' })).success).toBe(false)
  })

  it('saves a style from JSON, applies it, and follows the ranking it touched', async () => {
    const { project, ranking, work } = tools()
    const followed: string[] = []
    const style = { id: 's1', name: 'Aura', sounds: { onAction: [{ description: 'boom', soundId: 'b' }] } }
    const templates = {
      create: jest.fn(() => ({ ...style, labels: { tone: '' }, stickers: { habit: '' } })),
      get: jest.fn(() => ({
        ...style,
        labels: { examples: [], tone: 'deadpan' },
        perRankSec: 3.5,
        rankCount: 5,
        reveal: 'shuffle',
        sounds: { music: null, musicVolume: 0.3, onAction: [{ description: 'boom', soundId: 'b' }], reveal: null, transition: null },
        stickers: { examples: [], habit: '' },
        style: project.style,
        title: project.title,
        transition: { background: '#000000', durationSec: 1, enabled: false, text: '', textColor: '#ffffff' },
      })),
      list: jest.fn(() => []),
      update: jest.fn(),
    }
    const t = new RankingAgentTools({
      onRanking: (_s, id) => followed.push(id),
      ranking: ranking as never,
      sounds: { list: () => [] },
      templates: templates as never,
      workingDir: () => work,
    })
    expect((await t.call('s', 'ranking_style_save', { style: '{"name":"Aura"}' })).text).toMatch(/^Saved/)
    expect(templates.create).toHaveBeenCalledWith({ name: 'Aura' })
    expect((await t.call('s', 'ranking_style_save', { style: '{oops' })).success).toBe(false)
    expect(followed).toEqual([])
    const applied = await t.call('s', 'ranking_apply_style', { id: project.id, styleId: 's1' })
    expect(applied.text).toMatch(/Applied "Aura"/)
    expect(applied.text).toMatch(/boom \(soundId b\)/)
    expect(ranking.update).toHaveBeenCalledWith(project.id, expect.objectContaining({ reveal: expect.objectContaining({ mode: 'shuffle' }) }))
    expect(followed).toEqual([project.id])
    await t.call('s', 'ranking_get', { id: 'other' })
    expect(followed).toEqual([project.id])
    await t.call('s', 'ranking_create', { name: 'x' })
    expect(followed).toEqual([project.id, project.id])
  })

  it('refuses a TikTok link and a reference outside the working folder', async () => {
    const { t } = tools()
    expect((await t.call('s', 'ranking_analyze_reference', { url: 'https://www.tiktok.com/@a/video/1' })).text).toMatch(/TikTok/)
    expect((await t.call('s', 'ranking_analyze_reference', { path: '/etc/hosts' })).success).toBe(false)
    expect((await t.call('s', 'ranking_analyze_reference', {})).text).toMatch(/YouTube link/)
  })
})
