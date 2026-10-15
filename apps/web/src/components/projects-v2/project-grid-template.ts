// Single source for the projects grid column template. Every grid on the
// listing page (cards, search skeleton) and the
// controls row must share it so they produce identical auto-fill tracks and
// stay visually aligned without measuring layout in JS.
export const PROJECT_GRID_TEMPLATE_CLASSES =
  'grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fill,205px)]'
