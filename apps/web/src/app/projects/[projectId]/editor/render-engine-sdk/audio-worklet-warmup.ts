import { Logger } from '@reelmakeeasy/common/utils/logger'

const nsLogger = Logger.get('project.render-engine.audio-worklet-warmup')

/**
 * Some Chrome builds (seen on Chrome 155 / macOS 26) never load the module of the first
 * AudioWorklet on each fresh audio backing thread: `addModule` just hangs. Chrome pools
 * three dedicated threads and then one shared thread, so a page's first four
 * AudioContexts have no working worklet. The editor engine plays its audio through an
 * AudioWorklet and only recovers while playing (each `AudioQueueFull` restarts its audio
 * player on a new context, dropping the decoded audio), so the narration stayed silent for
 * the first seconds of the first Play.
 *
 * The warm-up uses up those stuck threads before the engine makes its own context: it
 * opens contexts one at a time, each trying a tiny module, until one loads it. The used
 * contexts are parked (suspended), never closed: closing one frees its thread and the next
 * context would stick again. Where the first context works, it costs one context.
 */
export interface AudioWorkletWarmupDeps {
  createContext: () => Pick<AudioContext, 'audioWorklet' | 'suspend'>
  logWarn: (message: string) => void
  maxContexts: number
  moduleUrl: () => { revoke: () => void; url: string }
  /** How long a context gets to load the module before it counts as stuck. */
  probeMs: number
  supported: () => boolean
}

const PROBE_MODULE =
  "registerProcessor('ly-warmup-probe', class extends AudioWorkletProcessor { process() { return false } })"

const defaultDeps = (): AudioWorkletWarmupDeps => ({
  // The options the engine uses for its own context.
  createContext: () => new AudioContext({ latencyHint: 'interactive', sampleRate: 48_000 }),
  logWarn: (message) => nsLogger.warn(message),
  maxContexts: 8,
  moduleUrl: () => {
    const url = URL.createObjectURL(new Blob([PROBE_MODULE], { type: 'text/javascript' }))
    return { revoke: () => URL.revokeObjectURL(url), url }
  },
  // A working context loads the (blob) module in a few ms; a stuck one never does.
  probeMs: 150,
  supported: () =>
    typeof window !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    typeof AudioWorkletNode !== 'undefined',
})

/** Kept for the page's life so their threads stay used. */
const parked: Pick<AudioContext, 'audioWorklet' | 'suspend'>[] = []
let warmup: Promise<number> | undefined

/** How many contexts the warm-up holds on this page. */
export function parkedAudioContextCount(): number {
  return parked.length
}

/** Test-only: forget the warm-up so each test starts on a fresh page. */
export function resetAudioWorkletWarmupForTest(): void {
  warmup = undefined
  parked.length = 0
}

/** Uses up stuck worklet threads once per page; resolves to the contexts it opened. */
export function warmUpAudioWorklet(deps: AudioWorkletWarmupDeps = defaultDeps()): Promise<number> {
  warmup ??= run(deps)
  return warmup
}

async function run(deps: AudioWorkletWarmupDeps): Promise<number> {
  if (!deps.supported()) return 0
  const { revoke, url } = deps.moduleUrl()
  let opened = 0
  try {
    for (let i = 0; i < deps.maxContexts; i++) {
      const ctx = deps.createContext()
      parked.push(ctx)
      opened += 1
      const loaded = await Promise.race([
        ctx.audioWorklet.addModule(url).then(
          () => true,
          () => false,
        ),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), deps.probeMs)),
      ])
      void ctx.suspend().catch(() => undefined)
      if (loaded) return opened
    }
    deps.logWarn(`AudioWorklet did not load in ${opened} contexts; audio may start late`)
    return opened
  } finally {
    revoke()
  }
}

/**
 * Warms up now when the page has had a click or key press (an AudioContext made before
 * one starts suspended), else on the first one. Resolves when a warm-up started now is
 * done, so the engine can wait for it.
 */
export function scheduleAudioWorkletWarmup(): Promise<unknown> {
  if (typeof window === 'undefined') return Promise.resolve()
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
    .userActivation
  if (!activation || activation.hasBeenActive) return warmUpAudioWorklet()
  const onGesture = () => {
    window.removeEventListener('pointerdown', onGesture, true)
    window.removeEventListener('keydown', onGesture, true)
    void warmUpAudioWorklet()
  }
  window.addEventListener('pointerdown', onGesture, true)
  window.addEventListener('keydown', onGesture, true)
  return Promise.resolve()
}
