import { z } from 'zod'

import { AGENT_TOOLS } from '../tools/agent-tools'

import { jsonSchemaToZodShape } from './json-schema-zod'

describe('jsonSchemaToZodShape', () => {
  it('converts every ReelMakeEasy tool schema', () => {
    for (const t of Object.values(AGENT_TOOLS))
      expect(() => jsonSchemaToZodShape(t.inputSchema)).not.toThrow()
  })

  it('keeps required, optional, enums, ranges and descriptions', () => {
    const shape = jsonSchemaToZodShape({
      additionalProperties: false,
      properties: {
        count: { minimum: 1, type: 'integer' },
        mood: { description: 'how it feels', enum: ['calm', 'dynamic'], type: 'string' },
        on: { type: 'boolean' },
        title: { type: 'string' },
        volume: { maximum: 100, minimum: 0, type: 'number' },
      },
      required: ['title', 'on'],
      type: 'object',
    })
    const s = z.object(shape).strict()
    expect(s.parse({ on: true, title: 't' })).toEqual({ on: true, title: 't' })
    expect(() => s.parse({ title: 't' })).toThrow()
    expect(() => s.parse({ mood: 'loud', on: true, title: 't' })).toThrow()
    expect(() => s.parse({ on: true, title: 't', volume: 101 })).toThrow()
    expect(() => s.parse({ count: 1.5, on: true, title: 't' })).toThrow()
    expect(shape['mood']?.description).toBe('how it feels')
  })

  it('refuses a shape it does not understand', () => {
    expect(() =>
      jsonSchemaToZodShape({ properties: { x: { type: 'array' } }, type: 'object' }),
    ).toThrow(/x/)
  })
})
