import FetchRetry from 'fetch-retry'
import pako from 'pako'

const fetchRetry = FetchRetry(fetch, {
  retries: 5,
  retryDelay: 1000,
})

export const getWasmBlob = () => {
  if (!process.env.NEXT_PUBLIC_WASM_PATH) {
    throw new Error('NEXT_PUBLIC_WASM_PATH is not set')
  }

  return fetchRetry(process.env.NEXT_PUBLIC_WASM_PATH)
    .then((response) => {
      return response.arrayBuffer()
    })
    .then((arrayBuffer) => {
      const compressedData = arrayBuffer
      const decompressedData = pako.inflate(new Uint8Array(compressedData))
      const blob = new Blob([decompressedData.buffer as BlobPart], { type: 'application/wasm' })
      return URL.createObjectURL(blob)
    })
    .catch(() => {
      return ''
    })
}
