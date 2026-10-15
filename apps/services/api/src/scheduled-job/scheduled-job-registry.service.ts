import { KvStore } from '@reelmakeeasy/common/kv/store'
import { logger } from '@reelmakeeasy/common/logger'
import { Injectable } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { ScheduledJobNameEnum } from './scheduled-job.dto'

export interface JobInfo {
  jobId: string
  jobName: ScheduledJobNameEnum
  startedAt: number
}

@Injectable()
export class ScheduledJobRegistryService {
  private readonly runningJobs = new Map<ScheduledJobNameEnum, JobInfo>()

  constructor(private readonly kv: KvStore) {}

  /**
   * Execute a callback with job registration.
   * Automatically registers before and releases after execution.
   */
  async withJob<T>(
    jobName: ScheduledJobNameEnum,
    lockTtlSeconds: number,
    callback: (jobId: string) => Promise<T>,
  ): Promise<{ executed: boolean; result?: T }> {
    const jobId = await this.registerJob(jobName, lockTtlSeconds)

    if (!jobId) {
      return { executed: false }
    }

    try {
      const result = await callback(jobId)
      return { executed: true, result }
    } finally {
      await this.releaseJob(jobName)
    }
  }

  private generateJobId(jobName: ScheduledJobNameEnum): string {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T.Z]/g, '')
      .slice(0, 14)
    return `${jobName}-${timestamp}-${nanoid(3)}`
  }

  private getLockKey(jobName: ScheduledJobNameEnum): string {
    return `scheduled:lock:${jobName}`
  }

  /**
   * Register a job and acquire its lock.
   * @param jobName - The name of the scheduled job
   * @param lockTtlSeconds - How long the lock should be held (should be less than cron interval)
   * @returns jobId if lock acquired, undefined if job is already running
   */
  private async registerJob(
    jobName: ScheduledJobNameEnum,
    lockTtlSeconds: number,
  ): Promise<string | undefined> {
    // Check if already running locally
    if (this.runningJobs.has(jobName)) {
      const existing = this.runningJobs.get(jobName)
      logger.info({ jobName, jobId: existing?.jobId }, 'Scheduled job already running locally')
      return undefined
    }

    // Try to acquire the lock
    const lockKey = this.getLockKey(jobName)
    const acquired = await this.kv.setNX(lockKey, Date.now().toString(), lockTtlSeconds)

    if (!acquired) {
      logger.info({ jobName }, 'Scheduled job is already running, skipping')
      return undefined
    }

    // Register job
    const jobId = this.generateJobId(jobName)
    this.runningJobs.set(jobName, {
      jobId,
      jobName,
      startedAt: Date.now(),
    })

    logger.info({ jobName, jobId }, 'Scheduled job registered')
    return jobId
  }

  /**
   * Release a job and its lock.
   */
  private async releaseJob(jobName: ScheduledJobNameEnum): Promise<void> {
    const jobInfo = this.runningJobs.get(jobName)

    // Release the lock
    try {
      await this.kv.del(this.getLockKey(jobName))
    } catch (error) {
      logger.warn({ jobName, error }, 'Failed to release scheduled job lock')
    }

    // Remove from local registry
    this.runningJobs.delete(jobName)

    const duration = jobInfo ? Date.now() - jobInfo.startedAt : 0
    logger.info({ jobName, jobId: jobInfo?.jobId, durationMs: duration }, 'Scheduled job released')
  }
}
