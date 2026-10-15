import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // twMerge's `z` validator only accepts integers/arbitrary values, so it doesn't
      // recognize z-tooltip as a member of the `z` group and won't resolve it against z-50.
      z: ['z-tooltip'],
    },
  },
})

/**
 * Tailwind-aware class combiner used by every component in the shadcn layer.
 *
 * Lives under `src/components/` so the dependency only flows
 * `src -> components`, never the reverse (MS1 decision record).
 *
 * @example
 * cn('p-2', isActive && 'bg-primary') // 'p-2 bg-primary' when active
 * cn('z-50', 'z-tooltip') // 'z-tooltip'
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
