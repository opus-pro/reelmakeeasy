import { type Avatar2D, drawArm, mouthShape, type Pose } from '../host'
import { eye } from '../toon'

/**
 * The avatar: a pixel-art starter to make your own. It is drawn like a 2D avatar (SVG in its
 * box) and always shown cut to a pixel grid, so draw it in bold, flat shapes of a few colours:
 * no thin lines, no gradients, no detail under about 20 units (its grid is about 9). Change
 * the colours, the hair, the face shape, the glasses or beard and the clothes until it looks
 * like the person; keep the rig (the pose drives the head, the eyes, the brows, the mouth and
 * the arms). The box: 1000 wide, origin at the waist (bottom centre), y up is negative; the
 * face's centre near y -900.
 */

const INK = '#2B2433'
const SKIN = '#F2C7A5'
const SKIN_SHADE = '#E3AC86'
const CHEEK = '#F29C8F'
const HAIR = '#4A3426'
const HAIR_LIGHT = '#6B4B37'
const IRIS = '#5B3A29'
const LIP = '#B5544F'
const SHIRT = '#3E6FB0'
const SHIRT_SHADE = '#335C93'
const COLLAR = '#F4F1EA'

/** The mouth at the origin: shut in a smile, or open in the vowel's shape. */
function mouth(p: Pose): string {
  if (p.mouth < 0.06) {
    const curve = 6 + p.smile * 24
    return `<path d="M -42,0 Q 0,${curve} 42,0" fill="none" stroke="${LIP}" stroke-width="8" stroke-linecap="round"/>`
  }
  const shape = mouthShape(p.vowel)
  const x = 44 * shape.w
  const h = Math.max(10, p.mouth * 74 * shape.h)
  const lift = p.smile * 6
  const d = `M ${-x},${-lift} Q 0,${-h * 0.32} ${x},${-lift} Q ${x * 0.85},${h} 0,${h * 1.05} Q ${-x * 0.85},${h} ${-x},${-lift} Z`
  const teeth =
    shape.w > 0.8 && h > 16
      ? `<path d="M ${-x * 0.75},${-h * 0.12} Q 0,${-h * 0.32} ${x * 0.75},${-h * 0.12} L ${x * 0.62},${h * 0.16} Q 0,${h * 0.05} ${-x * 0.62},${h * 0.16} Z" fill="#fff"/>`
      : ''
  const tongue =
    h > 30 ? `<ellipse cx="0" cy="${h * 0.8}" rx="${x * 0.5}" ry="${h * 0.2}" fill="#E07A86"/>` : ''
  return `<path d="${d}" fill="#5B1E2C"/>${teeth}${tongue}<path d="${d}" fill="none" stroke="${LIP}" stroke-width="5" stroke-linejoin="round"/>`
}

function head(p: Pose): string {
  // Features slide with the head's turn and nod; the whole head tilts about the neck.
  const fx = p.head.turn * 3.2
  const fy = p.head.nod * 2.4
  const gaze: [number, number] = [p.gaze[0] * 13, p.gaze[1] * 11]
  const brow = -p.brows * 22
  const eyes = [-1, 1]
    .map((s) =>
      eye({
        gaze,
        iris: IRIS,
        lid: Math.max(p.blink, p.smile > 0.9 ? 0.25 : 0),
        lidColor: SKIN,
        line: INK,
        lineW: 4,
        r: 17,
        rx: 33,
        ry: 37,
        x: s * 74 + fx,
        y: -915 + fy,
      }),
    )
    .join('')
  const brows = [-1, 1]
    .map(
      (s) =>
        `<path d="M ${s * 40 + fx},${-985 + fy + brow + s * 0} Q ${s * 76 + fx},${-1003 + fy + brow} ${s * 112 + fx},${-982 + fy + brow + 6}" fill="none" stroke="${HAIR}" stroke-width="15" stroke-linecap="round"/>`,
    )
    .join('')
  const face = `M 0,-1112 C 120,-1112 178,-1030 178,-905 C 178,-790 120,-688 0,-680 C -120,-688 -178,-790 -178,-905 C -178,-1030 -120,-1112 0,-1112 Z`
  return `<g transform="rotate(${p.head.tilt} 0 -690)">
    <path d="M -200,-1010 C -230,-1150 -100,-1210 0,-1205 C 110,-1210 235,-1150 205,-1000 L 190,-860 L -195,-860 Z" fill="${HAIR}" stroke="${INK}" stroke-width="8"/>
    <ellipse cx="${-176 + fx * 0.4}" cy="${-890 + fy}" rx="26" ry="40" fill="${SKIN}" stroke="${INK}" stroke-width="7"/>
    <ellipse cx="${176 + fx * 0.4}" cy="${-890 + fy}" rx="26" ry="40" fill="${SKIN}" stroke="${INK}" stroke-width="7"/>
    <path d="${face}" fill="${SKIN}" stroke="${INK}" stroke-width="8"/>
    <circle cx="${-112 + fx}" cy="${-830 + fy}" r="26" fill="${CHEEK}" opacity="${0.35 + p.smile * 0.25}"/>
    <circle cx="${112 + fx}" cy="${-830 + fy}" r="26" fill="${CHEEK}" opacity="${0.35 + p.smile * 0.25}"/>
    ${eyes}${brows}
    <path d="M ${-6 + fx * 1.1},${-885 + fy} Q ${14 + fx * 1.1},${-842 + fy} ${-8 + fx * 1.1},${-838 + fy}" fill="none" stroke="${SKIN_SHADE}" stroke-width="8" stroke-linecap="round"/>
    <g transform="translate(${fx},${-786 + fy})">${mouth(p)}</g>
    <path d="M -185,-990 C -170,-1120 -60,-1150 30,-1135 C 120,-1150 205,-1080 188,-985 C 150,-1050 90,-1060 40,-1040 C -20,-1075 -110,-1060 -185,-990 Z" fill="${HAIR}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>
    <path d="M -110,-1100 C -60,-1125 0,-1125 40,-1110" fill="none" stroke="${HAIR_LIGHT}" stroke-width="12" stroke-linecap="round"/>
  </g>`
}

function body(p: Pose): string {
  const up = p.shrug * 40
  return `<path d="M -250,0 L -238,-470 C -236,-560 -190,${-590 - up} -120,${-610 - up} L -60,${-640 - up} L 60,${-640 - up} L 120,${-610 - up} C 190,${-590 - up} 236,-560 238,-470 L 250,0 Z" fill="${SHIRT}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>
    <path d="M -170,-60 L -165,-420 M 170,-60 L 165,-420" stroke="${SHIRT_SHADE}" stroke-width="12" stroke-linecap="round"/>
    <rect x="-52" y="${-720 - up}" width="104" height="${110 + up * 0.5}" rx="30" fill="${SKIN}" stroke="${INK}" stroke-width="8"/>
    <path d="M -64,${-640 - up} L 0,${-560 - up} L 64,${-640 - up} L 38,${-650 - up} L 0,${-600 - up} L -38,${-650 - up} Z" fill="${COLLAR}" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`
}

export const avatar: Avatar2D = {
  draw(p: Pose) {
    const up = p.shrug * 40
    const sleeve = { cuff: SHIRT_SHADE, skin: SKIN, sleeve: SHIRT }
    return [
      body(p),
      head(p),
      drawArm(-1, p.left, [-215, -560 - up], sleeve),
      drawArm(1, p.right, [215, -560 - up], sleeve),
    ].join('')
  },
  name: 'Starter',
  style: 'pixel',
}
