// The tribute's edit: song ranges (seconds) and who fills them. Every range is tiled exactly by its
// owner's shots (`at` .. `at + length`, no gaps or overlaps); tools/cinema/edit.mjs checks it and
// fills anything missing with black. Times follow the reference soundtrack's cuts and transitions.
export const FPS = 24;
export const LENGTH = 174.17;
export const RANGES = [
  { id: 'card-rating', from: 0, to: 7.5, owner: 'cards', what: 'rating card, then black (the soundtrack is silent until 7.8 s)' },
  { id: 'card-map', from: 7.5, to: 39.5, owner: 'cards', what: 'parchment map of the six worlds, slow pans, presents line, fade to white' },
  { id: 'snow-open', from: 39.5, to: 68.7, owner: 'snow', what: 'dwarf face in a blizzard from white, his beast, they climb away, wide slope, white flash with leaves' },
  { id: 'night-elf', from: 68.7, to: 93.0, owner: 'night', what: 'night elf in a moonlit forest from white, dash, tracking run, change, leap, cyan whoosh' },
  { id: 'night-undead', from: 93.0, to: 111.0, owner: 'night', what: 'undead claws on glowing ground, green casting, meteor, impact, white' },
  { id: 'dusk-tauren', from: 111.0, to: 124.0, owner: 'dusk', what: 'fiery streak hits a ridge at sunset from white, tauren on the hill, camera flies out over the land' },
  { id: 'dusk-fire', from: 124.0, to: 143.96, owner: 'dusk', what: 'red smoke, orc roaring in a burning village, flames fill frame, tower hit by a fireball, giant smashes it' },
  { id: 'black-1', from: 143.96, to: 146.58, owner: 'black', what: 'black' },
  { id: 'snow-charge', from: 146.58, to: 151.92, owner: 'snow', what: 'the beast and the dwarf charge at the camera through the blizzard' },
  { id: 'night-explode', from: 151.92, to: 154.21, owner: 'night', what: 'green explosion, to white' },
  { id: 'dusk-clash', from: 154.21, to: 157.71, owner: 'dusk', what: 'orc against night elf at sunset, white flash' },
  { id: 'snow-frost', from: 157.71, to: 163.08, owner: 'snow', what: 'human mage casting frost among ice, ice pillar, tauren roaring in snowy pines' },
  { id: 'card-logo', from: 163.08, to: 174.17, owner: 'cards', what: 'a globe settles on the emblem, World of Crabcraft forged in by fire, holds, fades' },
];
