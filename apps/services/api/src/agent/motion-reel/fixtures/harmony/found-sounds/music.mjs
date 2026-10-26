// Test fixture (composer-harmony.test.ts): found sounds pitched into the chords. ceramic (a foley instrument) and wood
// (a drum) ring inharmonic modes for seconds on F#, Db and B over a C major pad; the check must see them.
export default () => ({
  bpm: 128,
  seed: 1,
  key: 'C',
  mode: 'ionian',
  progression: ['C'],
  voices: {
    pad: { inst: 'pad' },
    cer: { inst: 'ceramic', decay: 2, notes: ['F#5', 'Db5'] },
    wd: { inst: 'wood', decay: 1.5, notes: ['B4'] },
  },
  grids: { g: { pad: 'hold', cer: 'x.......x.......', wd: '....x.......x...' } },
  grid: 'g',
  sections: [{ name: 'a', bars: 4 }],
});
