// The tribute's 3D shots, every scene in song order (tools/cinema/capture.mjs --program).
import { shots as snow } from './scenes/snow.mjs';
import { shots as night } from './scenes/night.mjs';
import { shots as dusk } from './scenes/dusk.mjs';

export const shots = [...snow, ...night, ...dusk].sort((a, b) => a.at - b.at);
