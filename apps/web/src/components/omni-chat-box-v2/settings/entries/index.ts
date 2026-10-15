import type { SettingsEntry } from '../types'

import { captionRenderer } from './caption'
import { ratioRenderer } from './ratio'
import { sourceFilterRenderer } from './source-filter'
import type { EntryRenderer } from './types'
import { voiceRenderer } from './voice-over'

export const entryRenderers: Record<SettingsEntry['type'], EntryRenderer<SettingsEntry>> = {
  caption: captionRenderer as EntryRenderer<SettingsEntry>,
  ratio: ratioRenderer as EntryRenderer<SettingsEntry>,
  'source-filter': sourceFilterRenderer as EntryRenderer<SettingsEntry>,
  voice: voiceRenderer as EntryRenderer<SettingsEntry>,
}
