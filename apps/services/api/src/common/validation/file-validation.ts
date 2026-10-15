import { FileValidationException } from '../errors/error-response'

export interface FileLike {
  buffer: Buffer
  mimetype: string
  originalname: string
  size: number
}
export interface FileValidationOptions {
  allowedExtensions?: string[]
  maxSizeInMB: number
  minSizeInBytes?: number
}

export const IMAGE_VALIDATION: FileValidationOptions = {
  allowedExtensions: ['jpeg', 'jpg', 'png', 'webp'],
  maxSizeInMB: 10,
  minSizeInBytes: 100,
}

export const AUDIO_VALIDATION: FileValidationOptions = {
  allowedExtensions: ['mp3', 'wav', 'm4a', 'mp4', 'webm'],
  maxSizeInMB: 10,
  minSizeInBytes: 100,
}

export function createMulterSizeLimit(maxSizeInMB: number) {
  return {
    fileSize: maxSizeInMB * 1024 * 1024,
  }
}
export async function validateUploadedFile(
  file: FileLike,
  options: FileValidationOptions,
): Promise<void> {
  if (!file) {
    throw new FileValidationException('No file provided', 'MISSING_FILE', 'file')
  }

  // Validate file size
  if (options.minSizeInBytes && file.size < options.minSizeInBytes) {
    throw new FileValidationException(
      `File too small. Minimum size is ${formatFileSize(options.minSizeInBytes)}. File size: ${formatFileSize(file.size)}`,
      'FILE_TOO_SMALL',
      'file',
      { minSize: options.minSizeInBytes, actualSize: file.size },
    )
  }

  const maxSizeInBytes = options.maxSizeInMB * 1024 * 1024
  if (file.size > maxSizeInBytes) {
    throw new FileValidationException(
      `File too large. Maximum size is ${options.maxSizeInMB}MB. File size: ${formatFileSize(file.size)}`,
      'FILE_TOO_LARGE',
      'file',
      { maxSize: maxSizeInBytes, actualSize: file.size },
    )
  }

  // Validate file extension (simple approach)
  const fileExtension = getFileExtension(file.originalname)
  if (!fileExtension) {
    throw new FileValidationException(
      'File must have a valid extension',
      'INVALID_FILE_EXTENSION',
      'file',
    )
  }

  if (options.allowedExtensions && !options.allowedExtensions.includes(fileExtension)) {
    const allowedExtensionsDisplay = options.allowedExtensions.join(', ').toUpperCase()
    throw new FileValidationException(
      `Unsupported file extension "${fileExtension}". Please use one of: ${allowedExtensionsDisplay}`,
      'INVALID_FILE_EXTENSION',
      'file',
      { allowedExtensions: options.allowedExtensions, actualExtension: fileExtension },
    )
  }
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) {
    return '0 Bytes'
  }

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}
function getFileExtension(filename: string): null | string {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot === -1 || lastDot === filename.length - 1) {
    return null
  }
  return filename.slice(Math.max(0, lastDot + 1)).toLowerCase()
}
