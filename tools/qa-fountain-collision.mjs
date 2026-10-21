import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const out=process.env.CC_QA_SHOTS??'tmp/qa/fountains',tag=process.env.CC_QA_TAG??'after';await mkdir(out,{recursive:true});
const errors=[];const b=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
try{const p=await b.newPage({viewport:{width:1600,height:900}});p.setDefaultTimeout(60000);p.on('pageerror',e=>errors.push(e.message));await p.routeWebSocket('**/multiplayer*',w=>w.close());await p.addInitScript(()=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Collision audit'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.quality','high');});await p.goto('http://127.0.0.1:5249/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:240000});await p.evaluate(async()=>{const g=window.app.current.game;g.god=true;g.creatorTravel=true;g.ending.cancel();g.player.nextSwing=Infinity;await g.world2.enterTidecrown();});await p.waitForFunction(()=>!document.querySelector('.tidecrown-loading'));
const audit=await p.evaluate(async()=>{const {TC_CITY_STREETS,TC_LANDMARKS}=await import('/src/game/tidecrown/cityPlan.ts');const g=window.app.current.game,I=g.world2.tidecrown,col=I.collision,r=g.player.unit.radius,o={x:0,y:0,set(x,y){this.x=x;this.y=y;return this;}},streets=[];for(const s of TC_CITY_STREETS){let n=0,blocked=[];for(let i=1;i<s.points.length;i++){const a=s.points[i-1],b=s.points[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);for(let d=0;d<len;d+=.5){const x=a[0]+dx*d/len,z=a[1]+dz*d/len;I.resolve(x,z,r,o);n++;if(Math.hypot(o.x-x,o.y-z)>.02)blocked.push({x:+x.toFixed(2),z:+z.toFixed(2),grid:col.isBlockedCell(x,z),shapes:col.shapes.map((q,i)=>({q,i})).filter(({q})=>{if(q.kind===0)return !q.c.los&&Math.hypot(x-q.c.x,z-q.c.z)<q.c.r+r;const b=q.b,dx=x-b.x,dz=z-b.z;return !b.los&&Math.abs(b.c*dx-b.s*dz)<b.hx+r&&Math.abs(b.s*dx+b.c*dz)<b.hz+r;}).map(({q,i})=>({i,...q}))});}}streets.push({id:s.id,n,blocked});}window.__capitalLandmarks=TC_LANDMARKS;return{r,streets,shapes:col.shapes.length,city:col.shapes.length-I.layout.city.colliders.length};});await writeFile(`${out}/audit-${tag}.json`,JSON.stringify(audit,null,2));console.log(JSON.stringify({r:audit.r,shapes:audit.shapes,streets:audit.streets.map(s=>({id:s.id,samples:s.n,blocked:s.blocked.length,first:s.blocked[0]}))}));
if(tag!=='before'){
 const walk=audit.streets.filter(s=>!['grand-canal','north-canal'].includes(s.id));assert.deepEqual(walk.filter(s=>s.blocked.length).map(s=>({id:s.id,blocked:s.blocked.length})),[]);
 console.log(`PASS ${walk.length} walking streets, ${walk.reduce((n,s)=>n+s.n,0)} player-radius probes; water channels excluded`);
 const guards=await p.evaluate(()=>{const I=window.app.current.game.world2.tidecrown;return {count:I.layout.city.safetyKerbs.length,registered:I.layout.city.safetyKerbs.every(k=>I.collision.shapes.some(q=>q.kind===1&&q.b.x===k.x&&q.b.z===k.z&&q.b.hx===k.hx&&q.b.hz===k.hz))};});assert.ok(guards.count>0&&guards.registered);console.log('PASS visible safety kerbs share registered collision',guards);
}
  // Walks: every district's main street, the Grand Canal's quays, the harbour's quay and its long pier.
  const walks = await p.evaluate(async () => {
    const g = window.app.current.game, w = g.world;
    const P = await import('/src/game/tidecrown/cityPlan.ts');
    const C = await import('/src/sim/world/tidecrownCity.ts');
    const I = window.app.current.game.world2.tidecrown;
    const r = g.player.unit.radius, o = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } };
    const lines = P.TC_CITY_STREETS.filter((s) => s.main).map((s) => ({ id: s.id, pts: s.points }));
    lines.push({ id: 'market-ring', pts: P.streetById('market-ring').points });
    // The Grand Canal's quays, 1.5 back from the copings (past the bridges' ends).
    const c = C.TC_CANALS[0], off = c.width / 2 + C.TC_CANAL.wall + 1.5;
    for (const side of [1, -1]) {
      const q = c.points.map(([x, z], i) => {
        const a = c.points[Math.max(0, i - 1)], b = c.points[Math.min(c.points.length - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return [x - ((b[1] - a[1]) / l) * off * side, z + ((b[0] - a[0]) / l) * off * side];
      });
      lines.push({ id: `grand-canal-quay-${side > 0 ? 'south' : 'north'}`, pts: q.slice(0, -1) });
    }
    // The harbour: through the sea gate onto the quay, along it, down the ramp and out along the long pier to its crane.
    const hp = I.layout.city.harbour.pieces, piers = hp.filter((q) => q.piece === 'TC_Pier_10');
    const longPier = piers.filter((q) => Math.abs(q.z - piers[0].z) < 1);
    const ramp = hp.find((q) => q.ramp && Math.abs(q.z - longPier[0].z) < 1);
    lines.push({ id: 'harbour-quay', pts: I.layout.city.harbour.quayWalk });
    const top = [ramp.x - ramp.ramp.len / 2 - 1.5, ramp.z], foot = [ramp.x + ramp.ramp.len / 2, ramp.z];
    // In through the sea gate's passage (its centre, then 5 out along the quay wall's normal), onto the ramp's head.
    const gate = I.layout.placements.find((q) => q.piece === 'TC_WardGate' && q.sx > 1.1), gx = Math.sin(gate.yaw), gz = Math.cos(gate.yaw);
    lines.push({ id: 'harbour-pier', pts: [[gate.x - gx * 7, gate.z - gz * 7], [gate.x, gate.z], [gate.x + gx * 5, gate.z + gz * 5], top, foot, [longPier[0].x - 5, longPier[0].z], [longPier[longPier.length - 1].x - 8, longPier[0].z]] });
    return lines.map(({ id, pts }) => {
      let samples = 0, worst = 0, at = null, prev = null;
      const pushed = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1], n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
        for (let k = 0; k < n; k++) {
          const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n, y = w.heightAt(x, z);
          w.resolveCollision(x, z, r, o);
          if (Math.hypot(o.x - x, o.y - z) > 0.02) pushed.push([+x.toFixed(1), +z.toFixed(1)]);
          if (prev !== null && Math.abs(y - prev) > worst) { worst = Math.abs(y - prev); at = [+x.toFixed(1), +z.toFixed(1)]; }
          prev = y;
          samples++;
        }
      }
      return { id, samples, pushed: pushed.length, first: pushed.slice(0, 6), worst: +worst.toFixed(3), at };
    });
  });
  for (const wk of walks) {
    assert.equal(wk.pushed, 0, `${wk.id} is open: ${JSON.stringify(wk.first)}`);
    assert.ok(wk.worst < 0.45, `${wk.id} stays walkable: step ${wk.worst} at ${wk.at}`);
  }
  console.log(`PASS walks: ${walks.map((w) => `${w.id} ${w.samples}`).join(', ')} samples, none blocked, worst step ${Math.max(...walks.map((w) => w.worst))}`);

  // Overlaps, on the plan the island built from.
  const overlap = await p.evaluate(async () => {
    const P = await import('/src/game/tidecrown/cityPlan.ts');
    const H = await import('/src/game/tidecrown/houses.ts');
    const C = await import('/src/sim/world/tidecrownCity.ts');
    const G = await import('/src/sim/world/tidecrownGround.ts');
    const city = window.app.current.game.world2.tidecrown.layout.city;
    const lots = city.zones.flatMap((z) => z.plan.lots);
    const out = { houses: lots.length, houseHouse: [], houseLandmark: [], houseStreet: [], houseCanal: [], houseWay: [], landmarkStreet: [], landmarkCanal: [], landmarkLandmark: [] };
    const where = (q) => q.map(([x, z]) => [+x.toFixed(1), +z.toFixed(1)])[0];
    for (let i = 0; i < lots.length; i++) for (let j = i + 1; j < lots.length; j++) if (H.quadsOverlap(lots[i].corners, lots[j].corners)) out.houseHouse.push(where(lots[i].corners));
    // Landmarks by their solids (the keep-clear margins may touch); streets by their carriageways; canals by water and walls.
    const solids = P.TC_LANDMARKS.map((l) => ({ id: l.id, q: l.solids.map(([lx, lz, hx, hz]) => P.quad(l.x + Math.cos(l.yaw) * lx * l.scale + Math.sin(l.yaw) * lz * l.scale, l.z - Math.sin(l.yaw) * lx * l.scale + Math.cos(l.yaw) * lz * l.scale, hx * l.scale, hz * l.scale, l.yaw)) }));
    const streets = P.TC_CITY_STREETS.filter((s) => !s.id.includes('canal') && !s.id.startsWith('kings-way') && s.id !== 'gate-court');
    const canalHit = (q) => { for (let k = 0; k <= 16; k++) for (let m = 0; m <= 16; m++) { const u = k / 16, v = m / 16; const x = q[0][0] + (q[1][0] - q[0][0]) * u + (q[3][0] - q[0][0]) * v, z = q[0][1] + (q[1][1] - q[0][1]) * u + (q[3][1] - q[0][1]) * v; if (C.canalDistance(x, z) < C.TC_CANAL.wall) return true; } return false; };
    for (const l of lots) {
      for (const s of solids) if (s.q.some((q) => H.polyDist(l.corners, q) === 0)) out.houseLandmark.push([s.id, where(l.corners)]);
      for (const st of streets) if (H.polyLineDist(l.corners, st.points) < st.width / 2) out.houseStreet.push([st.id, where(l.corners)]);
      if (canalHit(l.corners)) out.houseCanal.push(where(l.corners));
      // The King's Way: its paving (6.5 each side) the whole way from the gate to the stair.
      for (const c of l.corners) { const [t, s] = G.tcAxisCoords(c[0], c[1]); if (t > -10 && t < 172 && Math.abs(s) < 6.5) out.houseWay.push(where(l.corners)); }
    }
    for (const s of solids) {
      for (const q of s.q) {
        for (const st of streets) if (H.polyLineDist(q, st.points) < st.width / 2) out.landmarkStreet.push([s.id, st.id]);
        if (canalHit(q)) out.landmarkCanal.push(s.id);
      }
      for (const o of solids) if (o !== s && s.q.some((a) => o.q.some((b) => H.quadsOverlap(a, b)))) out.landmarkLandmark.push([s.id, o.id]);
    }
    return out;
  });
  for (const k of ['houseHouse', 'houseLandmark', 'houseStreet', 'houseCanal', 'houseWay', 'landmarkStreet', 'landmarkCanal', 'landmarkLandmark']) assert.deepEqual(overlap[k], [], `no overlap: ${k}`);
  console.log(`PASS overlaps: ${overlap.houses} houses clear of each other, the landmarks, the streets, the King's Way and the canals; landmarks clear of streets, canals and each other`);

  // Nothing floats: the ground under every footprint is no lower than its base (a plinth or foundation reaches it).
  const floating = await p.evaluate(async () => {
    const P = await import('/src/game/tidecrown/cityPlan.ts');
    const I = window.app.current.game.world2.tidecrown, L = I.layout, city = L.city;
    const ground = (x, z) => L.col.terrain.heightAt(x, z);
    const out = { checked: 0, houses: [], landmarks: [], walls: [], furniture: [], stairs: [] };
    for (const z of city.zones) for (const l of z.plan.lots) {
      out.checked++;
      const s = l.spec, base = s.base ?? s.ground;
      for (const [x, zz] of l.corners) if (ground(x, zz) < base - 0.15) { out.houses.push([+x.toFixed(1), +zz.toFixed(1), +(base - ground(x, zz)).toFixed(2)]); break; }
    }
    for (const l of P.TC_LANDMARKS) {
      out.checked++;
      const y = ground(l.x, l.z) - 0.12;
      for (const [lx, lz, hx, hz] of l.solids.slice(0, 1)) for (const [ax, az] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
        const ox = lx + ax * hx * 0.95, oz = lz + az * hz * 0.95, x = l.x + (Math.cos(l.yaw) * ox + Math.sin(l.yaw) * oz) * l.scale, z = l.z + (-Math.sin(l.yaw) * ox + Math.cos(l.yaw) * oz) * l.scale;
        if (ground(x, z) < y - 0.6) out.landmarks.push([l.id, +x.toFixed(1), +z.toFixed(1), +(y - ground(x, z)).toFixed(2)]);
      }
    }
    for (const w of city.walls.runs) {
      out.checked++;
      const fx = w.x + Math.sin(w.yaw) * 1.2, fz = w.z + Math.cos(w.yaw) * 1.2;
      if (ground(fx, fz) < w.y - 0.05) out.walls.push([+w.x.toFixed(1), +w.z.toFixed(1), +(w.y - ground(fx, fz)).toFixed(2)]);
    }
    for (const s of P.TC_GRAND_STAIRS) {
      out.checked++;
      if (ground(s.x, s.z) < s.y - 0.4) out.stairs.push([s.id, +(s.y - ground(s.x, s.z)).toFixed(2)]);
    }
    for (const f of [...city.lamps, ...city.poles]) {
      out.checked++;
      const g0 = L.heightAt(f.x, f.z);
      if (Math.abs(ground(f.x, f.z) - g0) > 0.3 && !L.col.surfaceAt(f.x, f.z)) out.furniture.push([+f.x.toFixed(1), +f.z.toFixed(1)]);
    }
    return out;
  });
  for (const k of ['houses', 'landmarks', 'walls', 'stairs', 'furniture']) assert.deepEqual(floating[k], [], `nothing floats: ${k}`);
  console.log(`PASS footing: ${floating.checked} houses, landmarks, terrace walls, stairs, lamps and poles stand on the ground`);

  // Collision: a flood fill from the arrival over the playable box (0.5 apart): nothing below +1 on the harbour side;
  // the closest a crab gets to every canal wall (just off its kerb) stays within 0.5 of the street; every collider is
  // in the plan, so a fresh layout registers as many solids as the island holds after its near builds.
  const collision = await p.evaluate(async () => {
    const g = window.app.current.game, I = g.world2.tidecrown, r = g.player.unit.radius;
    const G = await import('/src/sim/world/tidecrownGround.ts');
    const C = await import('/src/sim/world/tidecrownCity.ts');
    const L = await import('/src/game/tidecrown/layout.ts');
    const o = { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } };
    const free = (x, z) => { I.resolve(x, z, r, o); return Math.hypot(o.x - x, o.y - z) < 0.02; };
    const step = 0.5, x0 = G.TC_BOUNDS.minX, z0 = G.TC_BOUNDS.minZ, nx = Math.floor((G.TC_BOUNDS.maxX - x0) / step) + 1, nz = Math.floor((G.TC_BOUNDS.maxZ - z0) / step) + 1;
    const state = new Int8Array(nx * nz).fill(-1), q = new Int32Array(nx * nz);
    const at = (i, j) => { const k = j * nx + i; if (state[k] < 0) state[k] = free(x0 + i * step, z0 + j * step) ? 1 : 0; return state[k]; };
    const ai = Math.round((G.TC_ARRIVAL[0] - x0) / step), aj = Math.round((G.TC_ARRIVAL[1] - z0) / step);
    const reached = new Uint8Array(nx * nz);
    let head = 0, tail = 0, n = 0;
    const low = [];
    if (at(ai, aj)) { q[tail++] = aj * nx + ai; reached[aj * nx + ai] = 1; }
    while (head < tail) {
      const k = q[head++], i = k % nx, j = (k - i) / nx, x = x0 + i * step, z = z0 + j * step;
      n++;
      // The harbour side: east of the quay wall, between the keep cliff and the estuary.
      if (x > 200 && z > -95 && z < 85 && I.height(x, z) < 1 && low.length < 10) low.push([x, z, +I.height(x, z).toFixed(2)]);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if ((!di && !dj) || ii < 0 || jj < 0 || ii >= nx || jj >= nz || reached[jj * nx + ii] || !at(ii, jj)) continue;
        reached[jj * nx + ii] = 1;
        q[tail++] = jj * nx + ii;
      }
    }
    let kerbs = 0, kerbLow = 0, kerbWorst = 0, kerbAt = null;
    for (const w of I.layout.city.canalWalls) {
      const len = Math.hypot(w.bx - w.ax, w.bz - w.az);
      for (let u = 0.5; u < len - 0.5; u += 0.5) {
        const f = u / len, lx = w.ax + (w.bx - w.ax) * f, lz = w.az + (w.bz - w.az) * f;
        let last = null;
        for (let d = 4; d >= 0; d -= 0.1) { const x = lx - w.nx * d, z = lz - w.nz * d; if (!free(x, z)) break; last = [x, z]; }
        if (!last) continue;
        kerbs++;
        const deficit = C.TC_CANAL.street - I.height(last[0], last[1]);
        if (deficit > 0.5) kerbLow++;
        if (deficit > kerbWorst) { kerbWorst = deficit; kerbAt = last.map((v) => +v.toFixed(1)); }
      }
    }
    const shapes = I.collision.shapes.length;
    I.refine(1e9);
    return { reached: n, low, kerbs, kerbLow, kerbWorst: +kerbWorst.toFixed(2), kerbAt, shapes, afterNear: I.collision.shapes.length, fresh: L.tidecrownLayout().col.shapes.length };
  });
  console.log(JSON.stringify(collision));
  assert.deepEqual(collision.low, [], 'the flood fill from the arrival reaches no point below +1 on the harbour side');
  assert.equal(collision.kerbLow, 0, `canal kerbs within 0.5 of the street: worst ${collision.kerbWorst} at ${collision.kerbAt}`);
  assert.ok(collision.kerbs > 500, `canal wall samples: ${collision.kerbs}`);
  assert.equal(collision.afterNear, collision.shapes, 'the near builds add no colliders');
  assert.equal(collision.fresh, collision.shapes, 'a fresh layout registers every solid the island holds');
  console.log(`PASS collision: ${collision.reached} points reached from the arrival, none below +1 on the harbour side; ${collision.kerbs} canal kerb samples within 0.5 of the street (worst ${collision.kerbWorst}); ${collision.shapes} solids, all from the plan`);


if(!process.env.CC_QA_NO_SHOTS){
await p.evaluate(()=>{const g=window.app.current.game;g.player.unit.hidden=true;g.world2.tidecrownPeople.hide();const c=document.querySelector('canvas');for(let a=c;a&&a!==document.body;a=a.parentElement)for(const e of a.parentElement.children)if(e!==a&&!e.contains(c))e.style.visibility='hidden';});
for(const [id,x,z]of [['cathedral-end',-116,-15],['terrace-end',191,-3],['kiln-end',-18,-91],['rim-end',85,-71],['noble-end',187,-29]]){
 await p.evaluate(({x,z})=>{const g=window.app.current.game,y=g.world.heightAt(x,z);g.player.unit.teleport(g.world,x,z+4);g.follow.update=function(){this.camera.position.set(x-9,y+6,z+12);this.camera.lookAt(x,y+.4,z);};},{x,z});await p.waitForTimeout(500);await p.screenshot({path:`${out}/${id}-${tag}.png`});
}
for(const id of ['fountain','upper-fountain']){await p.evaluate(id=>{const g=window.app.current.game,f=window.__capitalLandmarks.find(f=>f.id===id),y=g.world.heightAt(f.x,f.z);g.player.unit.teleport(g.world,f.x,f.z+20*f.scale);g.follow.update=function(){this.camera.position.set(f.x+12*f.scale,y+5*f.scale,f.z+18*f.scale);this.camera.lookAt(f.x,y+3*f.scale,f.z);};},id);await p.waitForTimeout(1200);await p.screenshot({path:`${out}/${id}-${tag}.png`});}
await p.evaluate(()=>{const g=window.app.current.game;g.world2.exitTidecrown();g.world2.enterSnow();});await p.waitForTimeout(4000);for(const a of [0,Math.PI/2,Math.PI,Math.PI*1.5]){await p.evaluate(a=>{const g=window.app.current.game,I=g.world2.fourth,x=-13,z=65,y=I.height(x,z);g.player.unit.hidden=true;g.player.unit.teleport(g.world,x+Math.sin(a)*10,z+Math.cos(a)*10);g.follow.update=function(){this.camera.position.set(x+Math.sin(a)*11,y+3.4,z+Math.cos(a)*11);this.camera.lookAt(x,y+1,z);};},a);await p.waitForTimeout(1000);await p.screenshot({path:`${out}/snow-${Math.round(a*100)}-${tag}.png`});}
console.log('PASS both capital fountains and four snow-fountain angles captured');
}
assert.deepEqual(errors,[]);console.log('PASS no browser errors');
}finally{await b.close();}
