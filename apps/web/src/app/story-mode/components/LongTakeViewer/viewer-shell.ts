// Height of the project-detail viewer shell.
//
// A full `100dvh` viewer must leave room for any banner that sits in normal
// document flow above it, or the document overflows and grows scrollbars on the
// bottom and right. The notification banner cluster publishes its
// measured height as `--global-top-banner-height` on <html>. Subtracting it
// keeps the viewer pinned to the visible area so only its inner regions
// (transcript card, scaled video preview) flex within it. Matches the offset
// other full-height surfaces use (DesktopSidebar / SidebarV2).
export const VIEWER_SHELL_HEIGHT = 'calc(100dvh - var(--global-top-banner-height, 0px))'
