export type Prompt<TProps> = ((props: TProps) => string) & {
  readonly meta: PromptMeta
}

export interface PromptConfig {
  /**
   * Human readable description that explains the prompt intent.
   */
  readonly description?: string
}

export interface PromptMeta {
  readonly createdAt: string
  readonly description: string
}

export type PromptRenderer<TProps> = (props: TProps) => string

/**
 * Creates a prompt wrapper around a pure renderer function.
 *
 * Prompts stay portable and serializable by accepting all inputs through `props`.
 * The wrapper reserves space for future telemetry/logging without changing call sites.
 */
export function createPrompt<TProps>(
  renderer: PromptRenderer<TProps>,
  config: PromptConfig = {},
): Prompt<TProps> {
  const meta: PromptMeta = Object.freeze({
    description: config.description ?? '',
    createdAt: new Date().toISOString(),
  })

  const prompt = ((props: TProps): string => renderer(props)) as Prompt<TProps>

  Object.defineProperty(prompt, 'meta', {
    configurable: false,
    enumerable: true,
    value: meta,
    writable: false,
  })

  return prompt
}
