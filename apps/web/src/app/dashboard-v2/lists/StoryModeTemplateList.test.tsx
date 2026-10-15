import type { QuickStartTemplate } from '@shared/types/assets/quick-start'
import { render, screen } from '@testing-library/react'

let mockTemplates: QuickStartTemplate[] = []
jest.mock('@/hooks/useStoryModeTemplates', () => ({
  useStoryModeTemplates: () => ({ templates: mockTemplates }),
}))
jest.mock('@/app/home/components/StoryModeDemoProjectsSection', () => ({
  StoryModeDemoProjectsSection: () =>
    jest.requireActual('react').createElement('div', null, 'demo gallery'),
}))

import { StoryModeTemplateList } from './StoryModeTemplateList'

function renderList() {
  const onWorkflowTemplatesChange = jest.fn()
  const view = render(
    <StoryModeTemplateList
      onStoryTemplateClick={jest.fn()}
      onWorkflowTemplatesChange={onWorkflowTemplatesChange}
      selectedUseCaseKey="script-to-video"
      visible
    />,
  )
  return { ...view, onWorkflowTemplatesChange }
}

describe('StoryModeTemplateList', () => {
  it('renders nothing, not even the heading, when there are no demos', () => {
    mockTemplates = []
    const { container, onWorkflowTemplatesChange } = renderList()
    expect(container.textContent).toBe('')
    expect(onWorkflowTemplatesChange).toHaveBeenCalledWith('story-mode', [])
  })

  it('shows the heading and the gallery when there are demos', () => {
    mockTemplates = [{ id: 'demo-1' } as unknown as QuickStartTemplate]
    renderList()
    expect(screen.getByText('Get inspired. Then make it yours.')).toBeTruthy()
    expect(screen.getByText('demo gallery')).toBeTruthy()
  })
})
