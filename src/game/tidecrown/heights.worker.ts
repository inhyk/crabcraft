// Tidecrown's landform heights and ground splat off the main thread (the island's first entry starts it under the
// fade): the heights first (the layout needs them), then the splat (the terrain step does).
import { buildTidecrownHeights } from '../../sim/world/tidecrownGround';
import { paintTidecrownSplat } from './splat';

self.onmessage = () => {
  const h = buildTidecrownHeights(), copy = h.slice();
  const post = (self as unknown as Worker).postMessage.bind(self);
  post({ heights: copy }, [copy.buffer]);
  const splat = paintTidecrownSplat(h);
  post({ splat }, [splat.buffer]);
};
