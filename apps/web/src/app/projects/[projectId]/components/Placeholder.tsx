'use client'

import { LogoReelMakeEasy } from '@/components/icons/core'

export const Placeholder: React.FC<{ status?: null | string; text?: null | string }> = ({
  text,
  status,
}) => {
  return (
    <article className="flex flex-row gap-3">
      <div className="flex flex-col relative items-start">
        <div className="w-full relative group flex flex-col items-start">
          <LogoReelMakeEasy className="mb-3 cursor-default opacity-30" height={18} width={18} />
          <span className="w-full min-w-0 flex-1">
            {status && <div className="text-secondary text-xs leading-5">{status}</div>}
            {text && <div className="text-secondary text-xs leading-5">{text}</div>}
          </span>
        </div>
      </div>
    </article>
  )
}
