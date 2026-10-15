'use client'

import * as TabsPrimitive from '@radix-ui/react-tabs'
import * as React from 'react'

import { cn } from '../../lib/utils'

/** Root of a tab set. Holds the active value (controlled or uncontrolled). */
const Tabs = React.forwardRef<HTMLDivElement, TabsPrimitive.TabsProps>((props, ref) => (
  <TabsPrimitive.Root ref={ref} {...props} />
))
Tabs.displayName = 'Tabs'

/** Row of TabsTrigger buttons. */
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    className={cn(
      'inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 font-sans text-muted-foreground',
      className,
    )}
    ref={ref}
    {...props}
  />
))
TabsList.displayName = 'TabsList'

/** Button that shows the TabsContent with the same value. */
const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 font-sans text-sm font-medium',
      'ring-offset-background transition-all',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      'disabled:pointer-events-none disabled:opacity-50',
      'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow',
      className,
    )}
    ref={ref}
    {...props}
  />
))
TabsTrigger.displayName = 'TabsTrigger'

/** Panel shown while its TabsTrigger is active. */
const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    className={cn(
      'mt-2 font-sans ring-offset-background',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      className,
    )}
    ref={ref}
    {...props}
  />
))
TabsContent.displayName = 'TabsContent'

export { Tabs, TabsContent, TabsList, TabsTrigger }
