import { ANIMATION_LOOKS } from '@reelmakeeasy/common/animation/looks'
import { VIDEO_DETAILS } from '@reelmakeeasy/common/motion-reel/video-detail'

import { animationDetailBrief as detailBrief } from './animation-detail'

describe('animationDetailBrief', () => {
  it('says the level, who to work as, and what it means for the look', () => {
    const brief = detailBrief('3d', 'xhigh')
    expect(brief).toMatch(/^## Detail: Extra high/)
    expect(brief).toContain('professional motion graphics designer')
    expect(brief).toContain('1,000 or more particles')
    expect(brief).toContain('150 or more parts')
  })

  it('sets the 8-bit pixel grid by level', () => {
    expect(detailBrief('8bit', 'low')).toContain('res={180}')
    expect(detailBrief('8bit', 'medium')).toContain('res={270}')
    expect(detailBrief('8bit', 'high')).toContain('res={360}')
    expect(detailBrief('8bit', 'xhigh')).toContain('res={540}')
  })

  it('has text for every look at every level', () => {
    for (const look of ANIMATION_LOOKS)
      for (const detail of VIDEO_DETAILS)
        expect(detailBrief(look.id, detail)).not.toContain('undefined')
  })
})
