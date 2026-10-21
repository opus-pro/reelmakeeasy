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
    addStickerImage: jest.fn(async () => ({
      imageUrl: `store://ranking/${project.id}/stickers/x.png`,
    })),
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
    expect(
      (await t.call('s', 'ranking_add_clip', { id: 'p', path: '../../etc/hosts', rank: 1 })).text,
    ).toMatch(/working folder/)
    expect(
      (await t.call('s', 'ranking_add_clip', { id: 'p', path: 'a.mp4', rank: 9 })).text,
    ).toMatch(/no rank 9/)
    expect(ranking.setClip).not.toHaveBeenCalled()
    fs.mkdirSync(path.join(work, 'attachments'))
    fs.writeFileSync(path.join(work, 'attachments', 'cat.mp4'), 'x')
    expect(
      (await t.call('s', 'ranking_add_clip', { id: 'p', path: 'missing.mp4', rank: 1 })).text,
    ).toMatch(/No file/)
  })

  it('stores a picture from the working folder for an image sticker', async () => {
    const { project, ranking, t, work } = tools()
    fs.writeFileSync(path.join(work, 'logo.png'), 'png')
    jest
      .spyOn(require('@reelmakeeasy/common/storage/file-store').fileStore, 'upload')
      .mockResolvedValue(undefined)
    const r = await t.call('s', 'ranking_add_sticker_image', { id: 'p', path: 'logo.png' })
    expect(r.success).toBe(true)
    expect(r.text).toContain(`store://ranking/${project.id}/stickers/x.png`)
    expect(ranking.addStickerImage).toHaveBeenCalledWith(
      'p',
      expect.stringMatching(/^store:\/\/tmp\/agent-ranking\//),
      'logo.png',
    )
    expect(
      (await t.call('s', 'ranking_add_sticker_image', { id: 'p', path: '/etc/hosts' })).success,
    ).toBe(false)
  })

  it('saves a style from JSON, applies it, and follows the ranking it touched', async () => {
    const { project, ranking, work } = tools()
    const followed: string[] = []
    const style = {
      id: 's1',
      name: 'Aura',
      sounds: { onAction: [{ description: 'boom', soundId: 'b' }] },
    }
    const templates = {
      create: jest.fn(() => ({ ...style, labels: { tone: '' }, stickers: { habit: '' } })),
      get: jest.fn(() => ({
        ...style,
        labels: { examples: [], tone: 'deadpan' },
        perRankSec: 3.5,
        rankCount: 5,
        reveal: 'shuffle',
        sounds: {
          music: null,
          musicVolume: 0.3,
          onAction: [{ description: 'boom', soundId: 'b' }],
          reveal: null,
          transition: null,
        },
        stickers: { examples: [], habit: '' },
        style: project.style,
        title: project.title,
        transition: {
          background: '#000000',
          durationSec: 1,
          enabled: false,
          text: '',
          textColor: '#ffffff',
        },
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
    expect((await t.call('s', 'ranking_style_save', { style: '{"name":"Aura"}' })).text).toMatch(
      /^Saved/,
    )
    expect(templates.create).toHaveBeenCalledWith({ name: 'Aura' })
    expect((await t.call('s', 'ranking_style_save', { style: '{oops' })).success).toBe(false)
    expect(followed).toEqual([])
    const applied = await t.call('s', 'ranking_apply_style', { id: project.id, styleId: 's1' })
    expect(applied.text).toMatch(/Applied "Aura"/)
    expect(applied.text).toMatch(/boom \(soundId b\)/)
    expect(ranking.update).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({ reveal: expect.objectContaining({ mode: 'shuffle' }) }),
    )
    expect(followed).toEqual([project.id])
    await t.call('s', 'ranking_get', { id: 'other' })
    expect(followed).toEqual([project.id])
    await t.call('s', 'ranking_create', { name: 'x' })
    expect(followed).toEqual([project.id, project.id])
  })

  it('refuses a TikTok link and a reference outside the working folder', async () => {
    const { t } = tools()
    expect(
      (await t.call('s', 'ranking_analyze_reference', { url: 'https://www.tiktok.com/@a/video/1' }))
        .text,
    ).toMatch(/TikTok/)
    expect((await t.call('s', 'ranking_analyze_reference', { path: '/etc/hosts' })).success).toBe(
      false,
    )
    expect((await t.call('s', 'ranking_analyze_reference', {})).text).toMatch(/YouTube link/)
  })

  it('makes AI clips in parallel, puts each under its rank, and points at their contact sheets', async () => {
    const { project, ranking, work } = tools()
    jest
      .spyOn(require('@reelmakeeasy/common/storage/file-store').fileStore, 'upload')
      .mockResolvedValue(undefined)
    const generate = jest.fn(
      async (o: { outputPath: string; prompt: string; resolution: string; seconds: number }) => {
        if (o.prompt.includes('FAIL')) throw new Error('provider said no')
        fs.writeFileSync(o.outputPath, 'mp4')
        return { costUsd: 0.2, durationSec: 5.18, model: 'minimax-h3-max-turbo' }
      },
    )
    const contactSheet = jest.fn(async (_video: string, out: string) =>
      fs.writeFileSync(out, 'jpg'),
    )
    const t = new RankingAgentTools({
      ai: { contactSheet, generate },
      ranking: ranking as never,
      sounds: { list: () => [] },
      workingDir: () => work,
    })
    const clips = JSON.stringify([
      { prompt: 'A fluffy orange cat misjudges a jump onto the counter.', rank: 1 },
      { prompt: 'A grey cat FAIL sees a cucumber and leaps straight up.', rank: 2 },
    ])
    // Without a resolution nothing is made: the agent gets the choices (best first) to ask about.
    const ask = await t.call('s', 'ranking_generate_clips', { clips, id: project.id, seconds: 5 })
    expect(ask.success).toBe(false)
    expect(ask.text).toMatch(/Ask the user which resolution/)
    expect(ask.text).toMatch(
      /1080p \(recommended[^)]*\): about \$0\.80 for 2 clips of 5 s; 768p: about \$0\.40 .*; 480p: about \$0\.25/,
    )
    expect(generate).not.toHaveBeenCalled()
    expect(
      (await t.call('s', 'ranking_generate_clips', { clips, id: project.id, resolution: '4k' }))
        .text,
    ).toMatch(/doesn't make 4k clips/)
    const r = await t.call('s', 'ranking_generate_clips', {
      clips,
      id: project.id,
      resolution: '1080p',
      seconds: 12,
    })
    expect(r.success).toBe(true)
    expect(r.text).toMatch(/Made 1 of 2 clips at 1080p \(about \$0\.20\)/)
    expect(r.text).toMatch(/Rank 2: not made \(provider said no\)/)
    expect(r.text).toMatch(/generated\/rank-1-\d+-sheet\.jpg/)
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: '1080p', seconds: 8 }),
    )
    expect(ranking.setClip).toHaveBeenCalledTimes(1)
    expect(
      (
        await t.call('s', 'ranking_generate_clips', {
          clips: '[{"rank":9,"prompt":"long enough prompt for a clip"}]',
          id: project.id,
        })
      ).text,
    ).toMatch(/no rank 9/)
  })
})
