import { formatFiles, names, Tree } from '@nx/devkit'

interface PromptGeneratorSchema {
  readonly description?: string
  readonly name: string
}

export async function promptGenerator(tree: Tree, schema: PromptGeneratorSchema): Promise<void> {
  if (!schema.name || schema.name.trim() === '') {
    throw new Error(
      'Please provide a prompt path or name, e.g. features/onboarding/prompts/welcome',
    )
  }

  const normalizedInput = normalizePath(schema.name)
  const segments = normalizedInput.split('/').filter(Boolean)

  if (segments.length === 0) {
    throw new Error('Prompt name cannot be empty')
  }

  const fileBaseName = segments.pop()

  if (!fileBaseName) {
    throw new Error('Prompt path must include a file name')
  }
  const directory = segments.join('/')
  const basePath = directory ? `${directory}/${fileBaseName}` : fileBaseName
  const promptFilePath = `${basePath}.prompt.ts`
  const testFilePath = `${basePath}.prompt.test.ts`

  if (tree.exists(promptFilePath)) {
    throw new Error(`Prompt file already exists at ${promptFilePath}`)
  }

  const promptNames = names(fileBaseName)
  const promptIdentifier = buildPromptIdentifier(promptNames.propertyName)
  const interfaceName = `${buildPromptIdentifier(promptNames.className)}Props`
  const description = schema.description ?? `${promptNames.className} prompt`

  tree.write(
    promptFilePath,
    `import { createPrompt } from '@shared/prompt-system/create-prompt'

export interface ${interfaceName} {
  /**
   * Primary subject that the model should address.
   */
  readonly topic: string
  /**
   * Optional supporting context that adds nuance to the topic.
   */
  readonly context?: string
  /**
   * Desired tone for the response. Defaults to a balanced, friendly voice.
   */
  readonly tone?: 'formal' | 'neutral' | 'casual'
}

export const ${promptIdentifier} = createPrompt<${interfaceName}>(
  ({ topic, context, tone = 'neutral' }) => {
    const contextLine = context?.trim() ? \`Context: \${context.trim()}\` : 'No additional context provided.'
    const toneLine = tone === 'neutral' ? 'Use a clear, confident tone.' : \`Adopt a \${tone} tone.\`

    return [
      'You are a thoughtful writing assistant.',
      toneLine,
      'Craft a concise response that highlights the most important details.',
      contextLine,
      '',
      \`Primary topic: \${topic}\`,
    ].join('\\n')
  },
  {
    description: '${escapeTemplate(description)}',
  },
)
`,
  )

  const samplePropsName = `${promptIdentifier}Example`

  const snapshot = [
    'You are a thoughtful writing assistant.',
    'Adopt a casual tone.',
    'Craft a concise response that highlights the most important details.',
    'Context: Highlight ease of collaboration for remote teams.',
    '',
    'Primary topic: async kickoff announcement',
  ].join(String.raw`\n`)

  tree.write(
    testFilePath,
    `import { ${promptIdentifier}, type ${interfaceName} } from './${fileBaseName}.prompt'

const ${samplePropsName}: ${interfaceName} = {
  context: 'Highlight ease of collaboration for remote teams.',
  tone: 'casual',
  topic: 'async kickoff announcement',
}

describe('${promptIdentifier}', () => {
  it('renders a stable snapshot', () => {
    const result = ${promptIdentifier}(${samplePropsName})

    expect(result).toMatchInlineSnapshot(\`
${snapshot}
\`)
  })

  it('guards against undefined artifacts', () => {
    const result = ${promptIdentifier}({ ...${samplePropsName}, context: undefined })

    expect(result).not.toMatch(/undefined/i)
  })
})
`,
  )

  await formatFiles(tree)
}

export default promptGenerator

function buildPromptIdentifier(base: string): string {
  if (base.endsWith('Prompt')) {
    return base
  }

  return `${base}Prompt`
}

function escapeTemplate(value: string): string {
  return value.replace(/'/g, String.raw`\'`)
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/\s+/g, '-')
    .replace(/\.prompt(\.ts)?$/i, '')
    .replace(/^\/+/, '')
}
