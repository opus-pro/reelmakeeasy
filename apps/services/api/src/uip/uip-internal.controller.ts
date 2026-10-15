/**
 * UIP Internal Controller -- callback endpoints for the session workflow's
 * activities (persist-session.ts, publish-status.ts), which run in this
 * process and call back over loopback. LoopbackOnlyGuard keeps them closed to
 * other machines even when HOST opens the API to the network.
 */

import { Body, Controller, Post, UseGuards } from '@nestjs/common'

import { LoopbackOnlyGuard } from '../agent/loopback-only.guard'

import { UipService } from './uip.service'

@Controller('uip-sessions/internal')
@UseGuards(LoopbackOnlyGuard)
export class UipInternalController {
  constructor(private readonly service: UipService) {}

  /**
   * Called by run-planner-turn activity when it starts processing an authoritative signal
   * (new protocol). Marks the nextAction record as claimed so retries won't re-send.
   */
  @Post('claim-next-action')
  async claimNextAction(@Body() body: { actionId: string; projectId: string }) {
    const claimed = await this.service.claimNextActionById(body.projectId, body.actionId)
    return { claimed }
  }

  /**
   * Called by the workflow's `checkDeadlineExpiredActivity` when a phase
   * deadline timer fires (script_review auto-continue or refinement
   * auto-confirm). The API decides whether to actually fire the action,
   * extend the deadline (user is still editing), or signal continue.
   *
   * Without this endpoint the refinement auto-lock chain breaks: the
   * activity 404s, retries 3x via local-activity retry policy, and the
   * workflow throws an unhandled `ActivityFailure` -- the user's
   * 5-minute idle never advances the session into video production.
   */
  @Post('deadline-expired')
  async deadlineExpired(
    @Body() body: { force?: boolean; intent: 'confirm' | 'continue'; projectId: string },
  ) {
    return this.service.resolveDeadlineExpired(body.projectId, body.intent, body.force)
  }

  //
  @Post('persist')
  async persistSnapshot(
    @Body()
    body: {
      newRaw?: {
        sessionState?: null | unknown
        spec?: null | unknown
      }
      projectId: string
      sessionState: unknown
    },
  ) {
    await this.service.persistFromCallback(body.projectId, body.sessionState, body.newRaw)
    return { ok: true }
  }

  //
  @Post('status')
  async publishStatus(@Body() body: { projectId: string; status: unknown }) {
    await this.service.publishStatusFromCallback(body.projectId, body.status)
    return { ok: true }
  }

  /**
   * Called by run-planner-turn activity when it receives a wake signal (new protocol).
   * API reads current state snapshot, claims the next pending action, and sends the
   * authoritative signal back. The activity returns early; the workflow
   * processes the signal on the next iteration, guaranteeing serial execution.
   */
  @Post('trigger-next-action')
  async triggerNextAction(@Body() body: { projectId: string }) {
    await this.service.triggerNextAction(body.projectId)
    return { ok: true }
  }
}
