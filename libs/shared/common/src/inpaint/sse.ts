const INPAINT_SSE_BUS_PREFIX = 'inpaint:'

/** Build the SSE bus key for an InpaintWorkflow run. */
export function inpaintSSEBusKey(workflowId: string): string {
  return INPAINT_SSE_BUS_PREFIX + workflowId
}
