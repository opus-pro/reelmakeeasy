import { Logger } from '@reelmakeeasy/common/utils/logger'

const nsLogger = Logger.get('project.logger', '')

export const logger = {
  debug: (msg: string, data?: object) => {
    if (process.env.NODE_ENV === 'development') {
      nsLogger.debug(`[MediaCache] ${msg}`, data ?? '')
    }
  },
  error: (msg: string, data?: object) => {
    nsLogger.error(`[MediaCache] ${msg}`, data ?? '')
  },
  info: (msg: string, data?: object) => {
    if (process.env.NODE_ENV === 'development') {
      nsLogger.info(`[MediaCache] ${msg}`, data ?? '')
    }
  },
  warn: (msg: string, data?: object) => {
    nsLogger.warn(`[MediaCache] ${msg}`, data ?? '')
  },
}
