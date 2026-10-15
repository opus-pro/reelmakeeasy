import { withWorkflowRevival } from '@reelmakeeasy/common/workflow/workflow-revival'
import { WorkflowNotFoundError } from '@reelmakeeasy/workflow-engine/common'

describe('withWorkflowRevival', () => {
  it('returns the result without restarting when the operation succeeds', async () => {
    const startFn = jest.fn(async () => undefined)
    await expect(withWorkflowRevival('wf-1', startFn, async () => 'ok')).resolves.toBe('ok')
    expect(startFn).not.toHaveBeenCalled()
  })

  it('restarts a workflow that is gone and retries the operation once', async () => {
    const startFn = jest.fn(async () => undefined)
    const operation = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new WorkflowNotFoundError('gone', 'wf-1', undefined))
      .mockResolvedValueOnce('revived')

    await expect(withWorkflowRevival('wf-1', startFn, operation)).resolves.toBe('revived')
    expect(startFn).toHaveBeenCalledTimes(1)
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('rethrows any other error without restarting', async () => {
    const startFn = jest.fn(async () => undefined)
    const boom = new Error('boom')
    await expect(
      withWorkflowRevival('wf-1', startFn, async () => {
        throw boom
      }),
    ).rejects.toBe(boom)
    expect(startFn).not.toHaveBeenCalled()
  })
})
