import { Logger } from '@reelmakeeasy/common/utils/logger'
import SparkMD5 from 'spark-md5'

const nsLogger = Logger.get('file-md5')

type BlobLike = Pick<Blob, 'slice'> & { mozSlice?: Blob['slice']; webkitSlice?: Blob['slice'] }

const fileProto = File.prototype as BlobLike

const blobSlice = fileProto.slice || fileProto.mozSlice || fileProto.webkitSlice

export function md5FileStream(file: File, chunkSize = 2097152): Promise<string> {
  const chunks = Math.ceil(file.size / chunkSize)
  let currentChunk = 0

  const fileReader = new FileReader()
  const spark = new SparkMD5.ArrayBuffer()

  return new Promise<string>((resolve, reject) => {
    fileReader.onload = function (e) {
      if (!e.target?.result) {
        reject(new Error('Failed to read file.'))
        return
      }
      spark.append(e.target.result as ArrayBuffer) // Append array buffer
      currentChunk++

      if (currentChunk < chunks) {
        loadNext()
      } else {
        resolve(spark.end())
      }
    }

    fileReader.onerror = function (err) {
      nsLogger.warn('oops, something went wrong.')
      reject(err)
    }

    function loadNext() {
      const start = currentChunk * chunkSize,
        end = Math.min(start + chunkSize, file.size)

      fileReader.readAsArrayBuffer(blobSlice.call(file, start, end))
    }

    loadNext()
  })
}
