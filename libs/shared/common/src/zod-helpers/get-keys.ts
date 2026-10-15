import z from 'zod'

/** extract keys from a zod object schema */
export function zodGetKeys<ZodObject extends z.ZodObject<z.ZodRawShape>>(obj: ZodObject) {
  return Object.keys(obj.shape) as (keyof z.infer<ZodObject>)[]
}
