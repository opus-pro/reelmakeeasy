import { strictifySchema, stripNulls } from './strict-schema'

describe('strictifySchema', () => {
  it('requires every property and makes the optional ones nullable', () => {
    const schema = {
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a'],
      type: 'object',
    }
    expect(strictifySchema(schema)).toEqual({
      additionalProperties: false,
      properties: { a: { type: 'string' }, b: { type: ['number', 'null'] } },
      required: ['a', 'b'],
      type: 'object',
    })
  })

  it('strictifies objects nested inside arrays', () => {
    const schema = {
      properties: {
        list: {
          items: { properties: { x: { type: 'string' }, y: { type: 'boolean' } }, type: 'object' },
          type: 'array',
        },
      },
      required: ['list'],
      type: 'object',
    }
    expect(strictifySchema(schema)).toEqual({
      additionalProperties: false,
      properties: {
        list: {
          items: {
            additionalProperties: false,
            properties: { x: { type: ['string', 'null'] }, y: { type: ['boolean', 'null'] } },
            required: ['x', 'y'],
            type: 'object',
          },
          type: 'array',
        },
      },
      required: ['list'],
      type: 'object',
    })
  })

  it('wraps an optional object property in anyOf with null', () => {
    const schema = {
      properties: {
        inner: { properties: { q: { type: 'string' } }, required: ['q'], type: 'object' },
      },
      type: 'object',
    }
    expect(strictifySchema(schema)).toEqual({
      additionalProperties: false,
      properties: {
        inner: {
          anyOf: [
            {
              additionalProperties: false,
              properties: { q: { type: 'string' } },
              required: ['q'],
              type: 'object',
            },
            { type: 'null' },
          ],
        },
      },
      required: ['inner'],
      type: 'object',
    })
  })

  it('keeps enum, and keeps anyOf with its object members strictified', () => {
    const schema = {
      properties: {
        kind: { enum: ['x', 'y'], type: 'string' },
        value: {
          anyOf: [{ type: 'string' }, { properties: { h: { type: 'number' } }, type: 'object' }],
        },
      },
      required: ['kind', 'value'],
      type: 'object',
    }
    expect(strictifySchema(schema)).toEqual({
      additionalProperties: false,
      properties: {
        kind: { enum: ['x', 'y'], type: 'string' },
        value: {
          anyOf: [
            { type: 'string' },
            {
              additionalProperties: false,
              properties: { h: { type: ['number', 'null'] } },
              required: ['h'],
              type: 'object',
            },
          ],
        },
      },
      required: ['kind', 'value'],
      type: 'object',
    })
  })

  it('turns an optional enum into anyOf with null so null stays a valid value', () => {
    const schema = { properties: { kind: { enum: ['x', 'y'], type: 'string' } }, type: 'object' }
    expect(strictifySchema(schema)['properties']).toEqual({
      kind: { anyOf: [{ enum: ['x', 'y'], type: 'string' }, { type: 'null' }] },
    })
  })

  it("rewrites openApi3 `nullable: true` (zod's .nullable()) as a null type", () => {
    const schema = {
      properties: {
        c: { nullable: true, type: 'string' },
        n: {
          nullable: true,
          properties: { q: { type: 'string' } },
          required: ['q'],
          type: 'object',
        },
      },
      required: ['c', 'n'],
      type: 'object',
    }
    expect(strictifySchema(schema)['properties']).toEqual({
      c: { type: ['string', 'null'] },
      n: {
        anyOf: [
          {
            additionalProperties: false,
            properties: { q: { type: 'string' } },
            required: ['q'],
            type: 'object',
          },
          { type: 'null' },
        ],
      },
    })
  })

  it('does not mutate its input', () => {
    const schema = {
      properties: {
        a: { items: { properties: { z: { type: 'string' } }, type: 'object' }, type: 'array' },
        b: { nullable: true, type: 'number' },
      },
      type: 'object',
    }
    const copy = structuredClone(schema)
    strictifySchema(schema)
    expect(schema).toEqual(copy)
  })
})

describe('stripNulls', () => {
  it('removes null-valued keys recursively and keeps array items', () => {
    expect(stripNulls({ a: 1, b: null, c: [{ d: null, e: 2 }] })).toEqual({ a: 1, c: [{ e: 2 }] })
  })

  it('with the original schema, strips only the nulls of optional properties', () => {
    const schema = {
      properties: {
        list: {
          items: {
            properties: { r: { nullable: true, type: 'string' }, o: { type: 'string' } },
            required: ['r'],
            type: 'object',
          },
          type: 'array',
        },
        opt: { type: 'string' },
        req: { nullable: true, type: 'string' },
      },
      required: ['req', 'list'],
      type: 'object',
    }
    expect(stripNulls({ list: [{ o: null, r: null }], opt: null, req: null }, schema)).toEqual({
      list: [{ r: null }],
      req: null,
    })
  })

  it('leaves primitives and arrays of primitives alone', () => {
    expect(stripNulls('x')).toBe('x')
    expect(stripNulls([1, null, 2])).toEqual([1, null, 2])
    expect(stripNulls(null)).toBeNull()
  })
})
