import {
  $convertFromMarkdownString,
  CODE,
  HEADING,
  LINK,
  QUOTE,
  type Transformer,
  TRANSFORMERS,
} from '@lexical/markdown'

import { LongTakeTransformer } from './LongTakeNode'
import { MetaTagTransformer } from './MetaTagNode'

// Transformers to exclude - we want these to remain as plain text
const EXCLUDED_TRANSFORMERS: Transformer[] = [HEADING, QUOTE, CODE, LINK]

// Filter out excluded transformers so markdown syntax is preserved as plain text
const FilteredTransformers = TRANSFORMERS.filter((t) => !EXCLUDED_TRANSFORMERS.includes(t))

export const DefaultTransformers = [
  MetaTagTransformer,
  LongTakeTransformer,
  ...FilteredTransformers,
]

export const TransformersWithoutLongTake = [MetaTagTransformer, ...FilteredTransformers]

export function convertToEditorState(
  initValue: string,
  transformers: Transformer[] = DefaultTransformers,
) {
  $convertFromMarkdownString(initValue, transformers)
}
