export function MobileProjectsHeader() {
  return (
    <div className="w-full">
      <div className="relative flex h-[54px] w-full items-center md:hidden">
        <div className="flex w-full items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold leading-[28.8px] tracking-[-0.6px] text-white">
            Projects
          </h1>
        </div>
      </div>
      <div className="hidden items-center gap-3 md:flex">
        <h1 className="text-4xl font-semibold leading-[39.6px] tracking-[-1.08px] text-white">
          Projects
        </h1>
      </div>
    </div>
  )
}
