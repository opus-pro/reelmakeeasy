import { cn } from '@shared/ui'

/** A small FREE or PAID tag next to a voice typing engine's name, styled like the voice picker's. */
export function PriceTag({ price }: { price: 'free' | 'paid' }) {
  return (
    <span
      className={cn(
        'rounded px-1 py-px text-[10px] font-semibold uppercase leading-3 tracking-wide',
        price === 'free' ? 'bg-[#A8E21F]/15 text-[#A8E21F]' : 'bg-white/10 text-white/70',
      )}
    >
      {price === 'free' ? 'Free' : 'Paid'}
    </span>
  )
}
