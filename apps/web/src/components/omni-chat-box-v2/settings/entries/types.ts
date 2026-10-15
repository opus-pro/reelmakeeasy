import type { DrawerView, SettingsEntry } from '../types'

export interface DrawerMenuItemContext<T extends SettingsEntry> {
  entry: T
  onNavigate: (view: DrawerView) => void
}

export interface DrawerSubPageContext<T extends SettingsEntry> {
  entry: T
  onBack: () => void
}

export interface EntryRenderer<T extends SettingsEntry> {
  renderDrawerMenuItem: (props: DrawerMenuItemContext<T>) => React.ReactNode

  renderDrawerSubPage?: (props: DrawerSubPageContext<T>) => React.ReactNode

  renderPopoverMenuItem?: (props: PopoverMenuItemContext<T>) => React.ReactNode

  type: T['type']
}

export interface PopoverMenuItemContext<T extends SettingsEntry> {
  activeSubmenu: 'caption' | 'ratio' | null
  entry: T
  onSourceFilterClick: () => void
  onSubmenuChange: (submenu: 'caption' | 'ratio' | null) => void
}
