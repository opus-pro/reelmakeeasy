// Rive animations imported as a bundler-resolved URL string. Declared here for shared/ui's own
// tsconfig (lib build / tests); the app has its own copy in apps/web/index.d.ts. These live in
// separate tsconfig programs, so the two declarations never collide.
declare module '*.riv' {
  const src: string
  export default src
}
