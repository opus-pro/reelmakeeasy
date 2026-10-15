import type { CaptionStyleSettings } from '@shared/types/api/caption-style'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const mockFetchApiDomain = jest.fn()
jest.mock('@/hooks/useApi', () => ({ useApi: () => ({ fetchApiDomain: mockFetchApiDomain }) }))

import { forgetCaptionFontSamples } from './caption-fonts'
import type { CaptionKind } from './caption-settings'
import { CaptionStyleControls } from './CaptionSettingsPanel'

// Radix sliders measure their track; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= jest.fn(() => ({
  disconnect: jest.fn(),
  observe: jest.fn(),
  unobserve: jest.fn(),
})) as unknown as typeof ResizeObserver

function renderControls(
  props: Partial<{
    accentSuggestion: null | string
    aspectRatio: string
    captionsOn: boolean
    disabled: boolean
    kind: CaptionKind
    loopNote: string
    note: string
    settings: CaptionStyleSettings | null
  }> = {},
) {
  const onChange = jest.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { container } = render(
    <CaptionStyleControls
      accentSuggestion={props.accentSuggestion ?? null}
      aspectRatio={props.aspectRatio ?? '9 / 16'}
      captionsOn={props.captionsOn}
      disabled={props.disabled}
      kind={props.kind ?? 'video'}
      loopNote={props.loopNote}
      note={props.note}
      onChange={onChange}
      settings={props.settings ?? null}
    />,
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  )
  return Object.assign(onChange, { container })
}

const pressed = (name: string) =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed') === 'true'

/**
 * Whether the classes `cn` left on `el` draw an outline (Tailwind 3: `outline` is the style;
 * `cn` follows Tailwind 4, where it is a width, and drops it next to `outline-2`).
 */
const outlined = (el: Element | null) => {
  const classes = el?.className.split(' ') ?? []
  return (
    classes.includes('outline-2') &&
    classes.some((c) => c === 'outline' || /^\[outline-style:(solid|dashed)\]$/.test(c))
  )
}

describe('CaptionStyleControls', () => {
  it("keeps a loop's highlight while captions are off: it still colours the fact stamps", () => {
    const onChange = renderControls({ captionsOn: false, kind: 'loop', note: 'Shows later' })
    expect(screen.queryByRole('button', { name: 'Punch' })).toBeNull()
    expect(screen.queryByRole('slider')).toBeNull()
    expect(
      screen.queryByText('Captions are off. The highlight still colours the fact stamps.'),
    ).not.toBeNull()
    expect(screen.queryByText('Shows later')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Pink' }))
    expect(onChange).toHaveBeenCalledWith({ accent: '#FF3EA5' })
  })

  it('shows nothing for any other video while captions are off', () => {
    const { container } = renderControls({ captionsOn: false, kind: 'video' })
    expect(container.innerHTML).toBe('')
  })

  it("marks the video kind's own style and picks another", () => {
    const onChange = renderControls({ kind: 'loop' })
    expect(pressed('Punch')).toBe(true)
    expect(pressed('Classic')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Explainer' }))
    expect(onChange).toHaveBeenCalledWith({ preset: 'explainer' })
  })

  it('marks a saved style over the default', () => {
    renderControls({ kind: 'loop', settings: { preset: 'classic' } })
    expect(pressed('Classic')).toBe(true)
    expect(pressed('Punch')).toBe(false)
  })

  it('marks green until another highlight is picked, and picks a swatch', () => {
    const onChange = renderControls()
    expect(pressed('Green')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Yellow' }))
    expect(onChange).toHaveBeenCalledWith({ accent: '#FFE500' })
  })

  it('rings the picked highlight only', () => {
    renderControls({ settings: { accent: '#FFE500' } })
    const circle = (name: string) => screen.getByRole('button', { name }).firstElementChild
    expect(outlined(circle('Yellow'))).toBe(true)
    expect(outlined(circle('Green'))).toBe(false)
    expect(outlined(screen.getByLabelText('Pick a colour').closest('label'))).toBe(false)
  })

  it('rings the colour circle for a colour of its own', () => {
    renderControls({ settings: { accent: '#123456' } })
    expect(outlined(screen.getByLabelText('Pick a colour').closest('label'))).toBe(true)
  })

  it("offers the agent's suggested colour only when there is one", () => {
    renderControls()
    expect(screen.queryByRole('button', { name: 'Suggested' })).toBeNull()
  })

  it("picks the agent's suggested colour", () => {
    const onChange = renderControls({
      accentSuggestion: '#7b61ff',
      settings: { accent: '#7B61FF' },
    })
    expect(pressed('Suggested')).toBe(true)
    expect(pressed('Green')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Suggested' }))
    expect(onChange).toHaveBeenCalledWith({ accent: '#7B61FF' })
  })

  it('marks a swatch as the suggested colour instead of repeating it', () => {
    // The agent's suggestion is often one of the swatches (a loop's yellow).
    const onChange = renderControls({
      accentSuggestion: '#ffe500',
      kind: 'loop',
      settings: { accent: '#FFE500' },
    })
    expect(screen.queryByRole('button', { name: 'Suggested' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Yellow' })).toBeNull()
    // One swatch is picked (the style tiles have no label of their own).
    const pickedSwatches = screen
      .getAllByRole('button', { pressed: true })
      .flatMap((b) => b.getAttribute('aria-label') ?? [])
    expect(pickedSwatches).toEqual(['Yellow (suggested)'])

    fireEvent.click(screen.getByRole('button', { name: 'Yellow (suggested)' }))
    expect(onChange).toHaveBeenCalledWith({ accent: '#FFE500' })
  })

  it('takes a typed colour code only when it is one, and says how to write it', () => {
    const onChange = renderControls()
    const code = screen.getByRole('textbox', { name: 'Colour code' })
    expect((code as HTMLInputElement).value).toBe('#04F827')

    fireEvent.change(code, { target: { value: '#12' } })
    expect(screen.queryByText('Type a colour like #04F827')).toBeNull()
    fireEvent.blur(code)
    expect(screen.getByText('Type a colour like #04F827')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.change(code, { target: { value: '00e5ff' } })
    expect(onChange).toHaveBeenCalledWith({ accent: '#00E5FF' })
    expect(screen.queryByText('Type a colour like #04F827')).toBeNull()
  })

  it('says when Punch shows a very light highlight in green instead', () => {
    renderControls({ settings: { accent: '#F0F0F0', preset: 'punch' } })
    expect(
      screen.getByText("Punch's words are white, so a very light highlight shows in green."),
    ).toBeTruthy()
  })

  it('says nothing about light highlights in the other styles', () => {
    renderControls({ settings: { accent: '#F0F0F0', preset: 'explainer' } })
    expect(screen.queryByText(/very light highlight/)).toBeNull()
  })

  it('picks any colour with the colour picker', () => {
    const onChange = renderControls()
    fireEvent.change(screen.getByLabelText('Pick a colour'), { target: { value: '#123456' } })
    expect(onChange).toHaveBeenCalledWith({ accent: '#123456' })
  })

  it("shows the height as how high the captions sit, at the style's own height until moved", () => {
    const onChange = renderControls()
    const height = screen.getByRole('slider', { name: 'Caption height' })
    // The style's slot is 81% down the frame: 19% up from the bottom.
    expect(height.getAttribute('aria-valuetext')).toBe('19% from the bottom')
    expect(screen.getByText('Height').parentElement?.textContent).toContain('19%')
    expect(screen.getByRole('button', { name: 'Reset height' })).toHaveProperty('disabled', true)

    // More height, higher captions: the saved centre moves up the frame.
    fireEvent.keyDown(height, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith({ position: 80 })
  })

  it('puts the height back to the style default with Reset', () => {
    const onChange = renderControls({ settings: { position: 30 } })
    expect(
      screen.getByRole('slider', { name: 'Caption height' }).getAttribute('aria-valuetext'),
    ).toBe('70% from the bottom')

    fireEvent.click(screen.getByRole('button', { name: 'Reset height' }))
    expect(onChange).toHaveBeenCalledWith({ position: null })
  })

  it("jumps to the frame's top, middle and bottom heights", () => {
    const onChange = renderControls({ aspectRatio: '16 / 9', settings: { position: 40 } })

    fireEvent.click(screen.getByRole('button', { name: 'Top' }))
    expect(onChange).toHaveBeenLastCalledWith({ position: 25.5 })
    fireEvent.click(screen.getByRole('button', { name: 'Middle' }))
    expect(onChange).toHaveBeenLastCalledWith({ position: 50 })
    // The bottom is the style's own height.
    fireEvent.click(screen.getByRole('button', { name: 'Bottom' }))
    expect(onChange).toHaveBeenLastCalledWith({ position: null })
  })

  it('places the 16:9 bottom lower, as the frame does', () => {
    renderControls({ aspectRatio: '16 / 9' })
    expect(
      screen.getByRole('slider', { name: 'Caption height' }).getAttribute('aria-valuetext'),
    ).toBe('12% from the bottom')
  })

  it('sizes from 60% to 160% and resets to 100%', () => {
    const onChange = renderControls({ settings: { size: 140 } })
    const size = screen.getByRole('slider', { name: 'Caption size' })
    expect(size.getAttribute('aria-valuetext')).toBe('140%')
    expect(size.getAttribute('aria-valuemin')).toBe('60')
    expect(size.getAttribute('aria-valuemax')).toBe('160')

    fireEvent.keyDown(size, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith({ size: 141 })
    fireEvent.click(screen.getByRole('button', { name: 'Reset size' }))
    expect(onChange).toHaveBeenLastCalledWith({ size: null })
  })

  it('has nothing to reset at 100%', () => {
    renderControls()
    expect(
      screen.getByRole('slider', { name: 'Caption size' }).getAttribute('aria-valuetext'),
    ).toBe('100%')
    expect(screen.getByRole('button', { name: 'Reset size' })).toHaveProperty('disabled', true)
  })

  it('locks every control while disabled', () => {
    const onChange = renderControls({ accentSuggestion: '#7B61FF', disabled: true })
    for (const name of ['Classic', 'Punch', 'Explainer', 'Green', 'Suggested', 'Top']) {
      expect(screen.getByRole('button', { name })).toHaveProperty('disabled', true)
    }
    expect(screen.getByRole('textbox', { name: 'Colour code' })).toHaveProperty('disabled', true)
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Caption size' }), { key: 'ArrowRight' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('gives a loop its own note, captions on or off, and any other video none', () => {
    const loopNote = 'Fact stamps show in the downloaded video'
    for (const captionsOn of [true, false]) {
      const { container } = renderControls({ captionsOn, kind: 'loop', loopNote })
      expect(screen.getByText(loopNote)).toBeTruthy()
      container.remove()
    }
    renderControls({ kind: 'video', loopNote })
    expect(screen.queryByText(loopNote)).toBeNull()
  })

  it('shows a note under the controls when given one', () => {
    renderControls({ note: 'Shows after the video renders again' })
    expect(screen.getByText('Shows after the video renders again')).toBeTruthy()
  })
})

describe('the Font row', () => {
  const PACK = [
    { family: 'Alegreya', file: 'Alegreya-Bold.ttf' },
    { family: 'Anton', file: 'Anton-Regular.ttf' },
    { family: 'DM Sans', file: 'DMSans-Bold.ttf' },
    { family: 'Dela Gothic One', file: 'DelaGothicOne-Regular.ttf' },
    { family: 'PT Serif', file: 'PTSerif-Bold.ttf' },
    { family: 'Roboto', file: 'Roboto-Black.ttf' },
    { family: 'Roboto Serif', file: 'RobotoSerif-Bold.ttf' },
  ].map(({ family, file }) => ({
    family,
    sampleUrl: `/api/caption-fonts/pack/${file}`,
    weights: [400],
  }))

  const fontButton = () => screen.getByRole('button', { name: /^Caption font:/ })
  const fontList = () => screen.getByRole('group', { name: 'Caption fonts' })
  const row = (name: string) => within(fontList()).getByRole('button', { name })
  const open = () => fireEvent.click(fontButton())
  const sampleFamily = (el: HTMLElement) =>
    (el.querySelector('[data-font-sample]') as HTMLElement | null)?.style.fontFamily

  /** FontFace in the page: samples whose URL contains `failing` don't load. */
  function installFontFace(failing?: string) {
    const FontFace = jest.fn((family: string, source: string) => ({
      family,
      load: () =>
        failing && source.includes(failing)
          ? Promise.reject(new Error('bad font'))
          : Promise.resolve(),
    }))
    Object.assign(globalThis, { FontFace })
    Object.defineProperty(document, 'fonts', { configurable: true, value: { add: jest.fn() } })
    return FontFace
  }

  beforeEach(() => {
    mockFetchApiDomain.mockReset()
    mockFetchApiDomain.mockResolvedValue({ data: { data: { pack: PACK } }, ok: true })
  })
  afterEach(() => {
    forgetCaptionFontSamples()
    delete (globalThis as { FontFace?: unknown }).FontFace
  })

  it("shows the style's own font until another is picked", () => {
    renderControls()
    expect(fontButton().textContent).toContain('Style default')
    expect(fontButton().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('group', { name: 'Caption fonts' })).toBeNull()
  })

  it('lists the style default first, then the seven built-in fonts', () => {
    renderControls()
    open()
    expect(fontButton().getAttribute('aria-expanded')).toBe('true')
    const rows = within(fontList()).getAllByRole('button')
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Style default',
      'Anton',
      'DM Sans',
      'Dela Gothic One',
      'Roboto',
      'Alegreya',
      'PT Serif',
      'Roboto Serif',
    ])
    expect(rows[0].getAttribute('aria-pressed')).toBe('true')
    expect(rows[0].textContent).toContain('Montserrat')
  })

  it('picks a font for the video and closes the list', () => {
    const onChange = renderControls()
    open()
    fireEvent.click(row('Dela Gothic One'))
    expect(onChange).toHaveBeenCalledWith({ font: { family: 'Dela Gothic One', source: 'pack' } })
    expect(screen.queryByRole('group', { name: 'Caption fonts' })).toBeNull()
  })

  it('puts the style default back by clearing the font', () => {
    const onChange = renderControls({ settings: { font: { family: 'Anton', source: 'pack' } } })
    expect(fontButton().textContent).toContain('Anton')
    open()
    expect(row('Anton').getAttribute('aria-pressed')).toBe('true')
    expect(row('Style default').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(row('Style default'))
    expect(onChange).toHaveBeenCalledWith({ font: null })
  })

  it('keeps the font when the style changes', () => {
    const onChange = renderControls({
      settings: { font: { family: 'PT Serif', source: 'pack' }, preset: 'classic' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Punch' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ preset: 'punch' })
    expect(fontButton().textContent).toContain('PT Serif')
  })

  it('shows a font it does not know as the style default', () => {
    renderControls({
      settings: {
        font: { family: 'Comic Sans', source: 'pack' },
      } as unknown as CaptionStyleSettings,
    })
    expect(fontButton().textContent).toContain('Style default')
  })

  it('has no Font row while captions are off', () => {
    renderControls({ captionsOn: false, kind: 'loop' })
    expect(screen.queryByRole('button', { name: /^Caption font:/ })).toBeNull()
  })

  it('is locked while the controls are', () => {
    renderControls({ disabled: true })
    expect(fontButton()).toHaveProperty('disabled', true)
  })

  it('reads the samples only once the list opens, and draws each name in its own font', async () => {
    const FontFace = installFontFace('PTSerif')
    renderControls()
    expect(mockFetchApiDomain).not.toHaveBeenCalled()

    open()
    // Plain text until each sample is in.
    expect(sampleFamily(row('Anton'))).toBeUndefined()
    expect(mockFetchApiDomain).toHaveBeenCalledWith('/api/caption-fonts', {
      method: 'GET',
      noThrowError: true,
    })

    await waitFor(() => expect(sampleFamily(row('Anton'))).toBe('ly-cap-anton'))
    expect(FontFace).toHaveBeenCalledWith(
      'ly-cap-anton',
      'url("http://localhost:5017/api/caption-fonts/pack/Anton-Regular.ttf")',
    )
    await waitFor(() => expect(sampleFamily(row('Roboto Serif'))).toBe('ly-cap-roboto-serif'))
    // A sample that fails stays in the app's own font.
    expect(FontFace).toHaveBeenCalledTimes(7)
    expect(sampleFamily(row('PT Serif'))).toBeUndefined()
    // Nothing picked: the row's name stays in the app's own font.
    expect(sampleFamily(fontButton())).toBeUndefined()
  })

  it('draws the picked font on the row once its sample is in', async () => {
    installFontFace()
    renderControls({ settings: { font: { family: 'DM Sans', source: 'pack' } } })
    open()
    await waitFor(() => expect(sampleFamily(fontButton())).toBe('ly-cap-dm-sans'))
  })

  it('still lists every font when the samples cannot be read', async () => {
    mockFetchApiDomain.mockResolvedValue({ data: null, error: 'down', ok: false })
    const FontFace = installFontFace()
    const onChange = renderControls()
    open()
    await waitFor(() => expect(mockFetchApiDomain).toHaveBeenCalled())
    expect(within(fontList()).getAllByRole('button')).toHaveLength(8)
    expect(FontFace).not.toHaveBeenCalled()
    fireEvent.click(row('Roboto'))
    expect(onChange).toHaveBeenCalledWith({ font: { family: 'Roboto', source: 'pack' } })
  })

  it('closes the list with Escape', () => {
    renderControls()
    open()
    fireEvent.keyDown(fontList(), { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Caption fonts' })).toBeNull()
  })
})
