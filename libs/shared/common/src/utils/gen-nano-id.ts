import { customAlphabet } from 'nanoid'

export const genNanoId = customAlphabet(
  'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  10,
)
