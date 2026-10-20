'use client'

import type { StickerImage } from '@reelmakeeasy/common/ranking/ranking-overlay'
import type { RankingSticker } from '@shared/types/api/ranking'
import { useEffect, useState } from 'react'

const cache = new Map<string, Promise<StickerImage | null>>()

/**
 * Loads a sticker picture for the canvas. Cross-origin with CORS (the API allows the web app),
 * so the canvas stays exportable (`toDataURL`).
 */
export function loadStickerImage(url: string): Promise<StickerImage | null> {
  let pending = cache.get(url)
  if (!pending) {
    pending = new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve({ height: img.naturalHeight, source: img, width: img.naturalWidth })
      img.onerror = () => {
        cache.delete(url)
        resolve(null)
      }
      img.src = url
    })
    cache.set(url, pending)
  }
  return pending
}

/** Every picture sticker's image, by URL, once loaded (the map updates as they arrive). */
export function useStickerImages(stickers: RankingSticker[] | undefined): ReadonlyMap<string, StickerImage> {
  const urls = (stickers ?? []).flatMap((s) => (s.kind === 'image' && s.imageUrl ? [s.imageUrl] : []))
  const key = urls.join('\n')
  const [images, setImages] = useState<ReadonlyMap<string, StickerImage>>(() => new Map())
  useEffect(() => {
    let live = true
    void Promise.all(urls.map(async (url) => [url, await loadStickerImage(url)] as const)).then((loaded) => {
      if (!live) return
      setImages(new Map(loaded.filter((e): e is readonly [string, StickerImage] => e[1] !== null)))
    })
    return () => {
      live = false
    }
    // `key` stands for `urls`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return images
}
