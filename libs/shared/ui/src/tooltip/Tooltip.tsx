import { cn } from '../lib/utils'
import {
  Tooltip as BaseTooltip,
  type TooltipProps as BaseTooltipProps,
  TooltipProvider,
} from '../primitives'

const Tooltip = ({ className, ...props }: BaseTooltipProps) => (
  <BaseTooltip
    // h-1.5 w-3 stands in for the width/height the facade does not expose, keeping
    // the 12x6 triangle the app has always drawn.
    arrowClassName="h-1.5 w-3 fill-[#444444]"
    className={cn('max-w-sm text-left font-medium font-sans', className)}
    {...props}
  />
)

export { TooltipProvider }
export default Tooltip
