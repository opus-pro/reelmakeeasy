import {
  Client,
  type Workflow,
  type WorkflowHandleWithFirstExecutionRunId,
  type WorkflowStartOptions,
} from '@reelmakeeasy/workflow-engine/client'

import { getLogger } from '../logger'

import { setupWorkflowEngine } from './engine-setup'
import { WorkflowDef } from './types'

const logger = getLogger('workflow-client')

let client: Client | null = null

export interface WrappedWorkflowClient {
  client: Client
  executeWorkflow: <W extends WorkflowDef>(
    wf: W,
    options: Omit<WorkflowStartOptions, 'args'>,
  ) => Promise<Required<W>['response']>
  startWorkflow: <WF extends WorkflowDef>(
    wf: WF,
    options: Omit<WorkflowStartOptions, 'args'>,
  ) => Promise<WorkflowHandleWithFirstExecutionRunId<Workflow>>
}

export async function createClient(): Promise<Client> {
  if (!client) {
    setupWorkflowEngine()
    client = new Client()
  }
  return client
}

export async function getWorkflowClient(): Promise<WrappedWorkflowClient> {
  const c = await createClient()
  return {
    client: c,
    executeWorkflow: async (wf, options) => {
      logger.info({ workflow: wf.name }, `Executing workflow: ${wf.name}`)
      return (await c.workflow.execute(wf.name, { args: [wf.arg], ...options })) as never
    },
    startWorkflow: (wf, options) => c.workflow.start(wf.name, { args: [wf.arg], ...options }),
  }
}
