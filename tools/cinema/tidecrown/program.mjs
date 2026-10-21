// A 96-second city portrait. Coordinates are the actual Tidecrown map, in metres.
// Lights are capture-only relighting presets, not a gameplay day/night feature.
const axis = (t, y, s = 0) => [40 + .3948 * t + .9189 * s, y, 128 - .9189 * t + .3948 * s];
const key = (t, p, l, fov = 50, roll = 0) => ({ t, p, l, fov, roll });
export const lights = {
  dawn: { sun: [-.8,.12,.58], key: '#ffc49a', power: 2.2, hemi: '#8293ca', bounce: '#685065', fill: .55, env: .15,
    sky: ['#344678','#a29bbf','#edb39e','#787b93','#ffe2b7','#ef9767','#dcaeae','#7b799b'], stars: .08, moon: 0, sunVis: 1, clouds: .48, fog: '#bdadc2', density: .00075, deep: '#123951', shallow: '#357d84' },
  day: { sun: [-.62,.65,.44], key: '#fff0d9', power: 3.5, hemi: '#a5c5ee', bounce: '#b09b78', fill: .85, env: .24,
    sky: ['#3171c4','#9ac3e5','#d9e9ef','#a9c5d5','#fff5d6','#efc398','#fff6e9','#9bb7d2'], stars: 0, moon: 0, sunVis: 1, clouds: .46, fog: '#bed4e2', density: .00035, deep: '#0c4b7a', shallow: '#33c1b2' },
  dusk: { sun: [-.83,.276,.48], key: '#ffa25a', power: 4.3, hemi: '#9497ea', bounce: '#a27b56', fill: .6, env: .24,
    sky: ['#4a5fd0','#c6b8de','#ffc68a','#e6cfb8','#fff0cc','#ffa050','#ffe4c8','#d4b6ca'], stars: 0, moon: 0, sunVis: 1, clouds: .62, fog: '#dcd6e6', density: .0006, deep: '#0c4b7a', shallow: '#33c1b2' },
  night: { sun: [-.45,.65,.61], key: '#a4beff', power: .78, hemi: '#657fae', bounce: '#202c4a', fill: .42, env: .12,
    sky: ['#07152d','#182d52','#425073','#14243a','#9dbbff','#283b64','#536482','#202e4b'], stars: .95, moon: .7, sunVis: 0, clouds: .32, fog: '#233751', density: .00065, deep: '#061b31', shallow: '#164753' },
};
let at = 0;
const shot = (id, label, mode, light, length, keys, extra = {}) => {
  const s = { id, label, mode, light, at, length, chapter: 7, actors: [],
    view: { exposure: light === 'night' ? 1.16 : 1, saturation: -.04, contrast: .02,
      bloom: { intensity: light === 'night' ? .5 : .25, threshold: 1.15 }, vignette: { offset: .3, darkness: .25 } },
    fog: { color: lights[light].fog, density: lights[light].density },
    cam: { keys, ease: 'linear', ...extra }, anchor: [60, 60] };
  at += length; return s;
};
export const shots = [
  shot('01-dawn-reveal', '새벽의 타이드크라운', 'DRONE', 'dawn', 10, [
    key(0, [-140,95,355], [65,53,-28], 53), key(10, [-70,125,285], [75,55,-35], 53)]),
  shot('02-six-shells', '여섯 껍질의 다리', 'FPV', 'dawn', 8, [
    key(0, axis(-100,16,-1), axis(30,25), 62), key(4, axis(-60,12,1), axis(35,23), 62, -.025), key(8, axis(-20,14,0), axis(40,23), 62)]),
  shot('03-pincer-gate', '집게 문에서 탈피 시장으로', 'FPV', 'day', 8, [
    key(0, axis(-17,14), axis(25,15), 66), key(3, axis(10,14), axis(50,16), 66), key(8, axis(61,19,1), axis(110,26), 66, .025)]),
  shot('04-city-roofs', '일곱 구역의 지붕', 'DRONE', 'day', 9, [
    key(0, [-185,155,135], [38,52,-35], 58), key(9, [-190,180,-12], [60,54,-58], 58)]),
  shot('05-cathedral', '조수 대성당', 'DRONE', 'day', 7, [
    key(0, [-89,53,55], [-31,57,-43], 56), key(7, [0,60,53], [-31,59,-43], 56)]),
  shot('06-canal-run', '운하 위를 날다', 'FPV', 'day', 8, [
    key(0, [108,13,103], [142,12,101], 68, -.025), key(3, [143,13,101], [180,16,93], 68, -.07), key(6, [186,25,91], [240,32,76], 68, -.035), key(8, [224,48,81], [285,23,46], 68)]),
  shot('07-crown-harbour', '왕관 항구', 'DRONE', 'day', 8, [
    key(0, [365,42,105], [268,14,18], 53), key(8, [347,65,-35], [252,18,28], 53)]),
  shot('08-crownshell', '크라운셸 성', 'DRONE', 'dusk', 8, [
    key(0, [330,158,-7], [150,110,-128], 52), key(4, [347,178,-128], [150,112,-128], 52), key(8, [295,202,-250], [150,115,-128], 52)]),
  shot('09-seaglass', '바다유리 구역', 'DRONE', 'dusk', 7, [
    key(0, [-162,83,-43], [-66,55,-122], 52), key(7, [-145,103,-161], [-56,54,-126], 52)]),
  shot('10-night-bridge', '도시의 불빛', 'FPV', 'night', 7, [
    key(0, axis(-92,13,-1), axis(15,27), 60), key(7, axis(-28,17,1), axis(35,28), 60)]),
  shot('11-night-harbour', '달빛 아래 왕관 항구', 'DRONE', 'night', 8, [
    key(0, [375,73,90], [220,80,-30], 59), key(8, [390,100,-15], [180,90,-65], 59)]),
  shot('12-night-crown', '타이드크라운', 'DRONE', 'night', 8, [
    key(0, [-135,155,285], [80,56,-35], 54), key(8, [-185,190,355], [80,60,-35], 54)]),
];
export const duration = at;
