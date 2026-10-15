import { Button, cn } from '@shared/ui'

interface ProjectLoadMoreBtnProps {
  className?: string
  fetchNextPage: () => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
}

export const ProjectLoadMoreBtn = ({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  className,
}: ProjectLoadMoreBtnProps) => {
  if (!hasNextPage) {
    return null
  }

  return (
    <div className={cn('flex w-full justify-center pt-6', className)}>
      <Button
        className="gap-1.5 rounded-sm border border-tertiary hover:bg-white/[0.18] hover:text-primary"
        disabled={isFetchingNextPage}
        onClick={() => {
          fetchNextPage()
        }}
        variant="ghost"
      >
        {isFetchingNextPage ? 'Loading more...' : 'Load more'}
      </Button>
    </div>
  )
}
