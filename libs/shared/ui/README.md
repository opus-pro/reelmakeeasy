# shared/ui

A shadcn/Radix-based atom component library, plus the design tokens the app's
light and dark themes are built from.

## Color and typography tokens

- The Tailwind color and font-size maps come from `createTailwindColors` /
  `createTailwindFontSize` in `src/tokens/`, wired in
  `tailwind.preset.ts`.
- Most colors read CSS variables defined in
  `apps/web/src/app/styles/ui-colors.css`.
