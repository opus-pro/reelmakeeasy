// Tailwind classes shared by Modal and Modal.alert. The app's global CSS and
// call sites layer their own classes on top through `classNames`, so keep these
// stable: changing one changes every dialog in the app.

export const OVERLAY_CLASS =
  'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'

const CONTENT_POSITION_CLASS =
  'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 bg-background p-6 shadow-lg duration-200 sm:rounded-lg'

const CONTENT_MOTION_CLASS =
  'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]'

export const MODAL_CONTENT_CLASS = `${CONTENT_POSITION_CLASS} border border-border font-sans ${CONTENT_MOTION_CLASS}`

export const MODAL_HEADER_CLASS =
  'flex flex-col space-y-1.5 text-center sm:text-left text-foreground'

export const MODAL_TITLE_CLASS = 'text-lg font-semibold leading-none tracking-tight'

export const DESCRIPTION_CLASS = 'text-sm text-muted-foreground'

export const MODAL_FOOTER_CLASS =
  'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-0'

export const MODAL_CLOSE_CLASS =
  'absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground'

const MODAL_BUTTON_CLASS =
  'flex h-9 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-sm p-2 text-sm font-medium transition-colors focus-visible:ring-0 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'

export const MODAL_CANCEL_CLASS = `${MODAL_BUTTON_CLASS} border border-input bg-background text-[#FAFAFA] shadow-sm hover:bg-accent hover:text-accent-foreground`

export const MODAL_CONFIRM_CLASS = `${MODAL_BUTTON_CLASS} bg-[#ffffff1a] text-primary`

export const ALERT_CONTENT_CLASS = `${CONTENT_POSITION_CLASS} border ${CONTENT_MOTION_CLASS}`

export const ALERT_HEADER_CLASS = 'flex flex-col space-y-2 text-center sm:text-left font-sans'

export const ALERT_TITLE_CLASS = 'text-lg font-semibold'

export const ALERT_FOOTER_CLASS = 'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2'

const ALERT_BUTTON_CLASS =
  'inline-flex h-9 cursor-pointer items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'

const ALERT_OUTLINE_CLASS =
  'mt-2 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground sm:mt-0'

// `p-2` must come before `px-4 py-2`: tailwind-merge drops an earlier
// `px-*`/`py-*` when a later `p-*` follows, but not the other way round.
const ALERT_ACTION_SPACING_CLASS = 'gap-2 p-2 px-4 py-2'

export const ALERT_CLOSE_CLASS = `${ALERT_BUTTON_CLASS} px-4 py-2 ${ALERT_OUTLINE_CLASS} absolute right-4 top-4`

export const ALERT_CANCEL_CLASS = `${ALERT_BUTTON_CLASS} ${ALERT_ACTION_SPACING_CLASS} ${ALERT_OUTLINE_CLASS} text-[#FAFAFA]`

export const ALERT_CONFIRM_CLASS = `${ALERT_BUTTON_CLASS} ${ALERT_ACTION_SPACING_CLASS} bg-primary text-primary-foreground shadow hover:bg-primary/90`
