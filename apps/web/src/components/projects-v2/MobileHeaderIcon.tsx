import { Button } from '@shared/ui'
import { type ComponentType, type SVGProps } from 'react'

export interface MobileHeaderIconProps {
  ariaLabel: string
  dataDdAction?: string
  Icon: ComponentType<SVGProps<SVGSVGElement>>
  onClick?: () => void
}

export function MobileHeaderIcon({
  dataDdAction,
  Icon,
  ariaLabel,
  onClick,
}: Readonly<MobileHeaderIconProps>) {
  return (
    <Button
      aria-label={ariaLabel}
      className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-fill-secondary text-white transition-colors md:hover:bg-fill-hover"
      data-dd-action={dataDdAction}
      onClick={onClick}
      size="icon"
      type="button"
      variant="default"
    >
      <Icon aria-hidden="true" className="size-[var(--mobile-icon-size)]" />
    </Button>
  )
}
