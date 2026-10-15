'use client'

interface MetaTagTextTooltipContentProps {
  text: string
}

export function MetaTagTextTooltipContent({ text }: MetaTagTextTooltipContentProps) {
  return (
    <div className="max-w-[320px] rounded-[10px] bg-[#444444] p-2 shadow-lg">
      <div className="px-1.5">
        <p className="text-[14px] leading-[22px] text-white">{text}</p>
      </div>
    </div>
  )
}
