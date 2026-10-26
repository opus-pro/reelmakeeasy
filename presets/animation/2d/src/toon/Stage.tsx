import { loadFont } from '@remotion/google-fonts/Fredoka'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'

import { back, clamp, L, lineAt, resetIds, ss } from './lib'

const { fontFamily } = loadFont('normal', { subsets: ['latin'], weights: ['500', '600', '700'] })

/** Who's who: the name on their speech bubble, and the bubble's colours. */
export type Cast = Record<
  string,
  { bubble: { bg: string; now: string; tag: string; tagfg: string }; name: string }
>

export type ToonStageProps = {
  /** The fun fact restated in a few words, shown on the end card after the last line. */
  card: string
  cast: Cast
  /** SVG <defs> content the scenes use (gradients, patterns). */
  defs?: string
  /** The 'diagram' line's full-screen picture: SVG markup for the 1080×1920 world. */
  diagram: (t: number, i: number) => string
  /** Every other line's picture: SVG markup for the 1080×1920 world. */
  scene: (t: number, i: number) => string
  /** One shot name per line, in order: 'wide', a character's close-up (its `who`), 'diagram',
   *  'end' (last), or any name your camera Frames use. */
  shots: string[]
}

/**
 * The 2D look's stage: on every frame, line i's scene (or the diagram), the speech bubble with the
 * words lighting up as they are said, and the fun-fact card after the last line. Put it in
 * `Animation.tsx` with `<Voice />` and `<Music />`; it replaces `<Captions />`.
 */
export function ToonStage({ card, cast, defs = '', diagram, scene, shots }: ToonStageProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  resetIds()
  const i = lineAt(t)
  const shot = shots[i] ?? 'wide'
  const picture = L.length ? (shot === 'diagram' ? diagram(t, i) : scene(t, i)) : scene(t, 0)
  const last = L.at(-1)
  const ek = last ? ss(last.end + 0.15, last.end + 0.6, t) : 0
  return (
    <AbsoluteFill style={{ backgroundColor: '#000', fontFamily }}>
      <svg
        dangerouslySetInnerHTML={{ __html: `<defs>${defs}</defs>${picture}` }}
        height="100%"
        style={{ position: 'absolute', inset: 0 }}
        viewBox="0 0 1080 1920"
        width="100%"
      />
      <Bubble cast={cast} t={t} />
      <div
        style={{
          background: '#FFD84D',
          borderRadius: 44,
          bottom: 120,
          boxShadow: '0 18px 0 rgba(0,0,0,.25)',
          boxSizing: 'border-box',
          color: '#2A2350',
          fontSize: 58,
          fontWeight: 600,
          left: '50%',
          lineHeight: 1.2,
          opacity: ek,
          padding: '34px 40px',
          position: 'absolute',
          textAlign: 'center',
          transform: `translateX(-50%) scale(${0.8 + 0.2 * back(ek)})`,
          width: 920,
        }}
      >
        <b style={{ color: '#6A4FD8', display: 'block', fontSize: 40, letterSpacing: '.08em', marginBottom: 10 }}>
          FUN FACT
        </b>
        {card}
      </div>
    </AbsoluteFill>
  )
}

/** The speech bubble: who is talking, and their words, each lit as it is said. */
function Bubble({ cast, t }: { cast: Cast; t: number }) {
  const line = L.find((l) => t >= l.start - 0.08 && t <= l.end + 0.18)
  if (!line) return null
  const who = cast[line.who] ?? {
    bubble: { bg: '#fff', now: '#E2574C', tag: '#F3B33D', tagfg: '#3A2410' },
    name: line.who,
  }
  const k = back(ss(line.start - 0.08, line.start + 0.18, t))
  const now = line.words.findIndex((w) => t >= w.start && t <= w.end + 0.08)
  const long = line.text.length > 64
  return (
    <div
      style={{
        background: who.bubble.bg,
        borderRadius: 48,
        boxShadow: '0 18px 0 rgba(0,0,0,.18)',
        boxSizing: 'border-box',
        left: '50%',
        opacity: clamp(k * 2) * (1 - ss(line.end + 0.05, line.end + 0.18, t)),
        padding: '30px 44px 38px',
        position: 'absolute',
        textAlign: 'center',
        top: 150,
        transform: `translateX(-50%) scale(${0.85 + 0.15 * k})`,
        transformOrigin: '50% 100%',
        width: 900,
      }}
    >
      <div
        style={{
          background: who.bubble.tag,
          borderRadius: 30,
          color: who.bubble.tagfg,
          display: 'inline-block',
          fontSize: 34,
          fontWeight: 700,
          letterSpacing: '.06em',
          marginBottom: 12,
          padding: '6px 22px',
          textTransform: 'uppercase',
        }}
      >
        {who.name}
      </div>
      <div style={{ color: '#B9B2C8', fontSize: long ? 56 : 66, fontWeight: 600, lineHeight: 1.18 }}>
        {line.words.map((w, j) => (
          <span
            key={`${w.start}-${j}`}
            style={{ color: j === now ? who.bubble.now : t >= w.start ? '#1E1838' : undefined }}
          >
            {w.text}{' '}
          </span>
        ))}
      </div>
      <div
        style={{
          borderLeft: '30px solid transparent',
          borderRight: '30px solid transparent',
          borderTop: `36px solid ${who.bubble.bg}`,
          bottom: -34,
          left: '50%',
          marginLeft: -30,
          position: 'absolute',
        }}
      />
    </div>
  )
}
