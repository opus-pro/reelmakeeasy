'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'

const nsLogger = Logger.get('audio-player')

/**
 * Shared callback contract for the generic audio player utility.
 *
 * Design intent:
 * - Keep this utility as the single reusable playback primitive for web UI.
 * - Push UI-specific state decisions to callers while centralizing low-level media wiring here.
 * - Provide stable lifecycle/event hooks so multiple product surfaces can reuse one implementation.
 *
 * Maintenance policy:
 * - Prefer extending callbacks over duplicating new ad-hoc audio logic in feature components.
 * - Avoid behavior changes unless there is a clear cross-surface need, because many callers rely on these semantics.
 */
export interface AudioPlayerCallbacks {
  /**
   * Fired when destroy() is called and this player instance has been torn down.
   */
  onDestroy?: () => void
  /**
   * Fired when playback reaches the natural end of media.
   */
  onEnded?: () => void
  /**
   * Fired when media element creation/playback fails.
   */
  onError?: (error: Error, stage?: AudioPlayerErrorStage) => void
  /**
   * Fired after metadata is available and duration is known.
   */
  onLoaded?: (duration: number) => void
  /**
   * Fired when audio is paused, either by calling pause()/reset() or by an external source
   * (e.g., browser media controls, OS audio interruption).
   * The external parameter is true when the pause originated outside AudioPlayer.
   */
  onPause?: (external: boolean) => void
  /**
   * Fired when audio begins or resumes playing, either via play() or an external source.
   * The external parameter is true when the play originated outside AudioPlayer.
   */
  onPlay?: (external: boolean) => void
  /**
   * Fired whenever current playback time changes, plus explicit lifecycle sync points.
   */
  onTimeUpdate?: (currentTime: number, duration: number) => void
}

export type AudioPlayerErrorStage = 'create' | 'play'

/**
 * Generic audio player for browser environments.
 *
 * Why this exists:
 * - Feature components should not each manage HTMLAudioElement lifecycle/event wiring.
 * - Centralization makes behavior consistent across voice preview, editor meta tags, and future audio surfaces.
 * - Keeping a single, battle-tested utility reduces repeated edge-case bugs (cleanup, replay, error handling).
 *
 * Reuse guidance:
 * - Reuse this class before introducing any new audio utility in apps/web.
 * - Keep this class generic and UI-agnostic; callers own UI state and presentation decisions.
 * - If new behavior is broadly useful, add it here with backward-compatible callbacks.
 *
 * Lifecycle contract:
 * - destroy() is terminal. After destroy() the instance is intentionally non-reusable.
 * - To play again after destroy(), create a new AudioPlayer instance.
 *
 * Toggle pattern:
 * - toggle() is intentionally not provided. Use the paused getter instead:
 *   if (player.paused) player.play() else player.pause()
 * - This keeps the toggle decision in the caller and avoids re-entrance ambiguity.
 */
export class AudioPlayer {
  /**
   * Mutable callback object so callers can replace handlers on a long-lived instance if needed.
   */
  public callbacks: AudioPlayerCallbacks
  /**
   * AudioPlayer-owned paused state.
   *
   * Returns false from the moment play() is called, even while the play promise is still
   * pending, and true after pause(), reset(), natural end, error, or an external pause event.
   *
   * Intended use for toggle:
   *   if (player.paused) player.play() else player.pause()
   */
  get paused(): boolean {
    return this._paused
  }
  /**
   * AudioPlayer-owned paused state, distinct from audio.paused:
   * - Set to false immediately when resumeCurrent() is called, before the play promise resolves.
   * - Set to true on pause(), reset(), ended, error, and external pause events.
   * - Stays accurate even when the audio element does not exist yet.
   */
  private _paused = true
  /**
   * Counts self-initiated audio.pause() calls whose async 'pause' task has not yet fired.
   *
   * The native pause event is queued as a media element task (HTML spec, internal pause steps),
   * not fired synchronously during audio.pause(). A boolean flag would be reset to false before
   * handlePause ever runs, so it cannot distinguish self-initiated from external pauses.
   *
   * A counter works correctly because:
   * - pause() and reset() increment it before calling audio.pause().
   * - handlePause() decrements it when absorbing a queued self-pause event.
   * - This holds even when multiple audio.pause() calls are made before any task fires,
   *   or when play() is called between audio.pause() and the queued task.
   *
   * Only incremented when audio.paused is false, because audio.pause() only queues a
   * pause task when transitioning from playing to paused (paused attribute was false).
   */
  private _pendingSelfPauseEvents = 0
  /**
   * Symmetric counterpart to _pendingSelfPauseEvents for the native 'play' event.
   * resumeCurrent() increments it before audio.play(); handlePlay() decrements it
   * to absorb the queued self-play task. Only events with counter == 0 are external.
   *
   * resumeCurrent() is only called when audio.paused is true, so audio.play() will
   * always queue a 'play' event, making it safe to always increment here.
   */
  private _pendingSelfPlayEvents = 0
  /**
   * Backing media element. Null means no element is currently allocated.
   */
  private audio: HTMLAudioElement | null = null
  /**
   * Last known playback cursor (seconds), mirrored from HTMLAudioElement.
   */
  private currentTime = 0
  /**
   * Last known duration (seconds), updated after metadata loads.
   */
  private duration = 0
  /**
   * Terminal lifecycle flag. Once true, public control methods become no-ops.
   */
  private isDestroyed = false
  /**
   * Tracks the active play() promise to discard stale completions during rapid play/pause cycles.
   */
  private playPromise: null | Promise<void> = null

  /**
   * Source URL is immutable for the lifetime of one player instance.
   */
  private readonly url: string

  /**
   * @param url Audio URL to play for this instance.
   * @param callbacks Event hooks for lifecycle/error/time notifications.
   */
  constructor(url: string, callbacks: AudioPlayerCallbacks = {}) {
    this.url = url
    this.callbacks = callbacks
  }

  /**
   * Fully tear down the player instance.
   *
   * Behavior:
   * - Detaches listeners and releases the media element.
   * - Resets internal time/duration snapshots to zero.
   * - Emits a final time sync so callers can deterministically reset UI.
   * - Emits onDestroy as the terminal lifecycle hook for this instance.
   */
  public destroy(): void {
    if (this.isDestroyed) {
      return
    }
    this.isDestroyed = true
    // releaseAudio removes listeners before calling audio.pause(), so handlePause
    // is not triggered and the self-pause counter is not needed here.
    this.releaseAudio()
    this._paused = true
    this.currentTime = 0
    this.duration = 0
    this.emitTimeUpdate()
    this.callbacks.onDestroy?.()
  }

  /**
   * Prepare media element and begin loading metadata without starting playback.
   *
   * This lets callers fetch duration in advance via onLoaded().
   */
  public load(): void {
    if (this.isDestroyed) {
      return
    }
    if (!this.url) {
      return
    }

    if (!this.audio) {
      this.createAudioElement()
    }
    this.audio?.load()
  }

  /**
   * Pause playback if an audio element exists.
   */
  public pause(): void {
    if (this.isDestroyed) {
      return
    }
    if (!this.audio) {
      return
    }
    // Count before audio.pause() so handlePause can absorb the queued task.
    // audio.pause() only queues a pause task when audio is currently playing.
    if (!this.audio.paused) {
      this._pendingSelfPauseEvents++
    }
    this.audio.pause()
    this._paused = true
    this.callbacks.onPause?.(false)
  }

  /**
   * Start (or resume) playback.
   *
   * Behavior:
   * - Lazily creates HTMLAudioElement on first play via load().
   * - Reuses existing element for subsequent resume attempts.
   * - No-op when URL is empty or audio is already playing (audio.paused === false).
   */
  public play(): void {
    if (this.isDestroyed) {
      return
    }
    if (!this.url) {
      return
    }

    this.load()

    if (this.audio?.paused) {
      this.resumeCurrent()
    }
  }

  /**
   * Stop playback and seek to the beginning.
   *
   * Emits an explicit time sync after seeking so callers do not depend on browser-specific
   * timeupdate timing to reset their UI.
   */
  public reset(): void {
    if (this.isDestroyed) {
      return
    }
    if (!this.audio) {
      return
    }
    // Same counter guard as pause().
    if (!this.audio.paused) {
      this._pendingSelfPauseEvents++
    }
    this.audio.pause()
    this.audio.currentTime = 0
    this.currentTime = 0
    this._paused = true
    this.callbacks.onPause?.(false)
    this.emitTimeUpdate()
  }

  /**
   * Allocate audio element and wire listeners once.
   */
  private createAudioElement(): void {
    try {
      const audio = new Audio(this.url)
      audio.crossOrigin = 'anonymous'
      audio.preload = 'auto'
      // Listener set is intentionally centralized here. Keep these in sync with resetLocalAudio().
      audio.addEventListener('ended', this.handleEnded)
      audio.addEventListener('error', this.handleError)
      audio.addEventListener('loadedmetadata', this.handleLoadedMetadata)
      audio.addEventListener('pause', this.handlePause)
      audio.addEventListener('play', this.handlePlay)
      audio.addEventListener('timeupdate', this.handleTimeUpdate)

      this.audio = audio
      this.currentTime = 0
      this.duration = 0
    } catch (error) {
      nsLogger.error('Error creating audio:', error)
      this.handlePlaybackError(error, 'create')
    }
  }

  /**
   * Single callback funnel to keep all time update call sites consistent.
   */
  private emitTimeUpdate(): void {
    this.callbacks.onTimeUpdate?.(this.currentTime, this.duration)
  }

  /**
   * Handle natural media completion.
   *
   * Seek element back to 0 before notifying callers so replay behavior is deterministic
   * across browsers regardless of native post-end cursor position.
   */
  private readonly handleEnded = (): void => {
    if (this.isDestroyed) {
      return
    }
    if (this.audio) {
      this.audio.currentTime = 0
    }
    this.currentTime = 0
    this._paused = true
    this.playPromise = null
    this.emitTimeUpdate()
    this.callbacks.onEnded?.()
  }

  /**
   * Normalize HTMLMediaElement error events into Error objects.
   */
  private readonly handleError = (event: Event): void => {
    if (this.isDestroyed) {
      return
    }
    const error =
      event instanceof ErrorEvent
        ? event.error || new Error('Audio playback failed')
        : new Error('Audio playback failed')
    this.handlePlaybackError(error)
  }

  /**
   * Capture duration once metadata is available.
   */
  private readonly handleLoadedMetadata = (): void => {
    if (this.isDestroyed) {
      return
    }
    if (!this.audio) {
      return
    }
    this.duration = this.audio.duration || 0
    this.callbacks.onLoaded?.(this.duration)
  }

  /**
   * Reflect external pauses in AudioPlayer state.
   *
   * Self-initiated pauses (via pause() and reset()) pre-increment _pendingSelfPauseEvents
   * before calling audio.pause(). Each queued self-pause task is absorbed here by
   * decrementing the counter. Only tasks with no pending count are external pauses
   * (e.g., browser media controls, OS audio interruption).
   */
  private readonly handlePause = (): void => {
    if (this.isDestroyed) {
      return
    }
    if (this._pendingSelfPauseEvents > 0) {
      this._pendingSelfPauseEvents--
      return
    }
    // External pause: state was not updated by pause() or reset(), so update it now.
    this._paused = true
    this.callbacks.onPause?.(true)
  }

  /**
   * Reflect external plays in AudioPlayer state.
   *
   * Uses the same counter pattern as handlePause. resumeCurrent() pre-increments
   * _pendingSelfPlayEvents before audio.play() so self-initiated play events are absorbed
   * here without affecting state. Only events with counter == 0 are external plays
   * (e.g., OS media controls resuming a paused track).
   */
  private readonly handlePlay = (): void => {
    if (this.isDestroyed) {
      return
    }
    if (this._pendingSelfPlayEvents > 0) {
      this._pendingSelfPlayEvents--
      return
    }
    // External play: state was not updated by resumeCurrent(), so update it now.
    this._paused = false
    this.callbacks.onPlay?.(true)
  }

  /**
   * Shared error path for create/play failures.
   */
  private handlePlaybackError(error: unknown, stage?: AudioPlayerErrorStage): void {
    if (this.isDestroyed) {
      return
    }
    const parsedError = error instanceof Error ? error : new Error('Audio playback failed')
    this._paused = true
    this.playPromise = null
    this.callbacks.onError?.(parsedError, stage)
  }

  /**
   * Mirror element currentTime and forward via callback.
   */
  private readonly handleTimeUpdate = (): void => {
    if (this.isDestroyed) {
      return
    }
    if (!this.audio) {
      return
    }
    this.currentTime = this.audio.currentTime || 0
    this.emitTimeUpdate()
  }

  /**
   * Detach all listeners and release the media element.
   * Called only from destroy() as part of terminal teardown.
   *
   * Listeners are removed before audio.pause() so none of the event handlers
   * are re-entered during teardown, making the self-pause/play counters unnecessary here.
   */
  private releaseAudio(): void {
    if (!this.audio) {
      return
    }

    // Remove all listeners before pausing so event handlers are not re-entered.
    this.audio.removeEventListener('ended', this.handleEnded)
    this.audio.removeEventListener('error', this.handleError)
    this.audio.removeEventListener('loadedmetadata', this.handleLoadedMetadata)
    this.audio.removeEventListener('pause', this.handlePause)
    this.audio.removeEventListener('play', this.handlePlay)
    this.audio.removeEventListener('timeupdate', this.handleTimeUpdate)

    this.audio.pause()
    this.audio = null
    this.playPromise = null
  }

  /**
   * Resume current audio and safely handle modern async play() semantics.
   *
   * _paused is set to false immediately so callers reading the paused getter synchronously
   * after play() see the correct state, even while the play promise is still pending.
   */
  private resumeCurrent(): void {
    if (this.isDestroyed) {
      return
    }
    if (!this.audio) {
      return
    }

    // Increment before audio.play() so the queued 'play' task is absorbed by handlePlay.
    // resumeCurrent() is only called when audio.paused is true, so a 'play' event will fire.
    this._pendingSelfPlayEvents++

    const playPromise = this.audio.play()
    this.playPromise = playPromise ?? null
    // Mark as playing immediately, before the promise resolves, so the paused getter
    // reflects intent rather than waiting for async browser confirmation.
    this._paused = false
    this.callbacks.onPlay?.(false)

    if (!playPromise) {
      return
    }

    // Discard stale promise completions so rapid play/pause cycles do not corrupt state.
    playPromise
      .then(() => {
        // Guard against the case where destroy() is called before the promise resolves.
        if (this.isDestroyed) {
          return
        }
        if (this.playPromise === playPromise) {
          this.playPromise = null
        }
      })
      .catch((error) => {
        // AbortError is the expected rejection when pause() is called while a play promise
        // is still pending. It is not a real error and should not reach onError.
        if (error?.name !== 'AbortError') {
          this.handlePlaybackError(error, 'play')
        }
        if (this.playPromise === playPromise) {
          this.playPromise = null
        }
      })
  }
}
