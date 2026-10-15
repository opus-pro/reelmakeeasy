import { NotFoundException } from '@nestjs/common'

import { DemoProjectsController } from './demo-projects.controller'

// Reads the shipped presets/story-mode/demos.json, which has no demos.
describe('DemoProjectsController with no demos', () => {
  const controller = new DemoProjectsController()

  it('lists an empty page', () => {
    expect(controller.list({ projectType: 'STORY_MODE', q: 'findByProjectType' })).toEqual({
      data: [],
      pagination: { page: 1, pageSize: 20, pageTotal: 0, total: 0 },
    })
  })

  it('answers 404 for any demo id', () => {
    expect(() => controller.get('some-demo')).toThrow(NotFoundException)
  })
})
