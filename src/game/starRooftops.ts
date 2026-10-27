import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {TownBuilder} from '../world/buildings';
import type {Lot} from '../world/layout';
import type {Kit, StaticBatch} from '../world/kit';
import {silverMaterial} from './starMasonry';
import {STAR_ECLIPSE_DIR} from './starNight';

/*
 * Starhaven's own roofline and doorsteps, so its houses stop reading as the shore's kit houses in silhouette: a
 * crescent finial on every ridge end, an observatory dome on the astronomer's house with its telescope out of the
 * slit, brass telescopes on two more ridges aimed at the eclipse, lanterns on ridge poles, a lantern by every door
 * (its light is baked into the ground, see starDoorLampGlows, and lights the walls, see starLight.ts), star-map
 * banners beside the doors and smoke from the chimneys catching the lamplight. One draw per kind.
 * The houses' kit pieces are read as they are placed (StaticBatch.add), never rebuilt or moved.
 */

/** Which house carries what (star-home-<i>; lots from starLots). */
export const STAR_ROOF_ROLES = {dome: 'star-home-7', telescopes: ['star-home-1', 'star-home-5'], ridgeLamps: ['star-home-0', 'star-home-4', 'star-home-6', 'star-tavern'], empty: 'star-home-2'} as const;

/** Door lanterns of the given lots: the kit builder's wall anchors (beside each door, 1.55 m up), no kit needed. */
export function starDoorLamps(lots: readonly Lot[]): {pos: THREE.Vector3; yaw: number}[] {
  const b = new TownBuilder(null, null, null, {});
  for (const l of lots) b.build(l);
  return b.doorLamps;
}
/** Where a door lantern hangs (on its bracket, out from the wall) and its pool on the ground. */
export function doorLanternAt(d: {pos: THREE.Vector3; yaw: number}, out = new THREE.Vector3()) {
  return out.set(d.pos.x + Math.sin(d.yaw) * .32, d.pos.y + .05, d.pos.z + Math.cos(d.yaw) * .32);
}
export function starDoorLampGlows(lots: readonly Lot[]) {
  return starDoorLamps(lots).map((d) => ({x: d.pos.x + Math.sin(d.yaw) * .9, z: d.pos.z + Math.cos(d.yaw) * .9, radius: 1.9, color: '#ffa850', strength: 2.1}));
}

/**
 * Lanterns along the pilgrim trails outside the town, every 13 m or so on alternate sides, so the side trails read at
 * night and from above. Thin posts, not solid (like the high street's lanterns). (x, z, yaw toward the trail.)
 */
export function starTrailLanterns(trails: readonly (readonly (readonly [number, number])[])[], skip: (x: number, z: number) => boolean): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const [ti, t] of trails.entries()) {
    let carry = 6, side = ti % 2 ? 1 : -1;
    for (let i = 1; i < t.length; i++) {
      const [ax, az] = t[i - 1], [bx, bz] = t[i], len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len;
      for (let d = carry; d < len; d += 13) {
        const x = ax + dx * d - dz * side * 2.05, z = az + dz * d + dx * side * 2.05;
        side = -side;
        if (Math.abs(x) < 54 && z > 3 && z < 100) continue;
        if (skip(x, z)) continue;
        out.push([x, z, Math.atan2(-dz * side, dx * side)]);
      }
      carry = (carry - len) % 13; if (carry < 0) carry += 13;
    }
  }
  return out;
}
export function starTrailLanternGlows(spots: readonly [number, number, number][]) {
  return spots.map(([x, z]) => ({x, z, radius: 2.1, color: '#ffae58', strength: 2.4}));
}

/** Records the house pieces the town builder places that the roofline needs. */
export function recordRooftops(batch: StaticBatch) {
  const rec = {roofs: [] as {name: string; m: THREE.Matrix4}[], chimneys: [] as {name: string; m: THREE.Matrix4}[]};
  const add = batch.add.bind(batch);
  batch.add = (piece, m, opts) => {
    if (piece.startsWith('Roof_RoundTiles_')) rec.roofs.push({name: piece, m: m.clone()});
    else if (piece.startsWith('Prop_Chimney')) rec.chimneys.push({name: piece, m: m.clone()});
    add(piece, m, opts);
  };
  return rec;
}

const iron = () => new THREE.MeshStandardMaterial({color: '#1e1f29', metalness: .7, roughness: .45, name: 'star-roof-iron'});
const lit = (geos: THREE.BufferGeometry[]) => { const g = mergeGeometries(geos.map((p) => { const q = p.index ? p.toNonIndexed() : p; q.deleteAttribute('uv'); return q; }), false)!; g.computeVertexNormals(); return g; };

/** A small iron lantern (cap, base, four bars) and its glass, origin at the glass centre. */
function lanternParts(): {frame: THREE.BufferGeometry; glass: THREE.BufferGeometry} {
  const cap = new THREE.LatheGeometry([new THREE.Vector2(0, .26), new THREE.Vector2(.05, .25), new THREE.Vector2(.17, .14), new THREE.Vector2(.15, .12)], 6);
  const base = new THREE.LatheGeometry([new THREE.Vector2(.12, -.13), new THREE.Vector2(.13, -.16), new THREE.Vector2(.05, -.21), new THREE.Vector2(0, -.22)], 6);
  const ring = new THREE.TorusGeometry(.05, .012, 4, 10); ring.translate(0, .31, 0);
  const bars = [0, 1, 2, 3, 4, 5].map((k) => { const a = k / 6 * Math.PI * 2; const b = new THREE.BoxGeometry(.018, .26, .018); b.translate(Math.cos(a) * .12, 0, Math.sin(a) * .12); return b; });
  const frame = lit([cap, base, ring, ...bars]);
  const glass = new THREE.CylinderGeometry(.11, .1, .25, 6, 1); glass.deleteAttribute('uv');
  return {frame, glass};
}

/** A crescent moon finial on a short spike: the horns point up. */
function finialGeometry(): THREE.BufferGeometry {
  const spike = new THREE.CylinderGeometry(.018, .035, .5, 6); spike.translate(0, .25, 0);
  const ball = new THREE.SphereGeometry(.055, 8, 6); ball.translate(0, .5, 0);
  const moon = new THREE.TorusGeometry(.2, .04, 6, 20, Math.PI * 1.35); moon.rotateZ(Math.PI * 1.5 - Math.PI * .675); moon.translate(0, .74, 0);
  const star = new THREE.OctahedronGeometry(.05, 0); star.scale(.6, 1.4, .6); star.translate(0, .98, 0);
  return lit([spike, ball, moon, star]);
}

/** A brass telescope on its tripod, aimed along local +Z and up by `elev`. */
function telescopeGeometry(len: number, elev: number): THREE.BufferGeometry {
  const prof = [[0, -.5], [.05, -.5], [.05, -.46], [.065, -.44], [.065, -.1], [.075, -.08], [.075, .32], [.09, .34], [.095, .5], [.08, .5]].map(([r, y]) => new THREE.Vector2(r * len, y * len));
  const tube = new THREE.LatheGeometry(prof, 10); tube.rotateX(Math.PI / 2 - elev); tube.translate(0, .85, 0);
  const legs = [0, 1, 2].map((k) => { const a = k / 3 * Math.PI * 2 + .5; const l = new THREE.CylinderGeometry(.018, .022, .95, 5); l.translate(0, -.47, 0); l.rotateX(.32); l.rotateY(a); l.translate(0, .85, 0); return l; });
  const head = new THREE.SphereGeometry(.07, 8, 6); head.translate(0, .85, 0);
  return lit([tube, ...legs, head]);
}

const BANNER_GLSL = /* glsl */ `
float bnH(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float bnSeg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.,1.));}
`;
/** Star-map banners: navy cloth, a silver crescent, a constellation joined by fine lines, a swallow-tail hem. */
function bannerMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({color: '#1d2550', roughness: .85, side: THREE.DoubleSide, name: 'star-roof-banner'});
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vBnUv;varying float vBnSeed;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvBnUv=uv;vBnSeed=0.;\n#ifdef USE_INSTANCING\nvBnSeed=fract(instanceMatrix[3].x*.37+instanceMatrix[3].z*.71);\n#endif');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec2 vBnUv;varying float vBnSeed;\n${BANNER_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec2 q=vBnUv*vec2(.8,1.7);
// Swallow-tail hem.
if(vBnUv.y<.14-abs(vBnUv.x-.5)*.28)discard;
float ink=0.;
// Border.
float bd=min(min(vBnUv.x,1.-vBnUv.x)*.8,(1.-vBnUv.y)*1.7);ink=max(ink,1.-smoothstep(.025,.04,bd));
// Crescent near the top.
vec2 c=q-vec2(.4,1.38);float cr=max(length(c)-.17,-(length(c-vec2(.07,.04))-.15));ink=max(ink,1.-smoothstep(0.,.012,cr));
// Constellation: five stars joined in a chain.
float dl=9.;vec2 pr=vec2(0.);
for(int i=0;i<5;i++){vec2 s=vec2(.16+.48*bnH(vec2(float(i),vBnSeed*31.)),.3+.17*float(i)+.06*bnH(vec2(vBnSeed*17.,float(i))));
  ink=max(ink,1.-smoothstep(.02,.034,length(q-s)));if(i>0)dl=min(dl,bnSeg(q,pr,s));pr=s;}
ink=max(ink,(1.-smoothstep(.004,.01,dl))*.7);
diffuseColor.rgb=mix(diffuseColor.rgb*(.8+.2*vBnUv.y),vec3(.78,.82,.92),ink);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(.12,.16,.26)*ink;');
  };
  m.customProgramCacheKey = () => 'star-roof-banner';
  return m;
}

/** Chimney smoke: soft camera-facing puffs rising and widening, lit by the moon above and the hearth below. */
function smokeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'star-roof-smoke', transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {sTime: {value: 0}}]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform float sTime;attribute float aPhase;varying vec2 vUv;varying float vAge;
      void main(){
        float age=fract(sTime*.055+aPhase);vAge=age;vUv=uv;
        vec3 base=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
        float k=fract(aPhase*7.31);
        vec3 c=base+vec3(.9*age*age+.25*sin(sTime*.4+k*9.)*age,age*4.2,.5*age*age*(k-.5));
        float size=.45+1.5*age;
        vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]),up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
        vec4 mvPosition=viewMatrix*vec4(c+(right*position.x+up*position.y)*size,1.);
        gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      varying vec2 vUv;varying float vAge;
      void main(){
        vec2 p=vUv*2.-1.;float r=dot(p,p);
        float puff=(1.-smoothstep(.2,1.,r))*(.75+.25*sin(p.x*5.+vAge*7.)*sin(p.y*4.-vAge*5.));
        float a=puff*smoothstep(0.,.12,vAge)*(1.-smoothstep(.45,1.,vAge))*.32;
        vec3 col=mix(vec3(.5,.3,.18),vec3(.16,.19,.28),smoothstep(0.,.3,vAge));
        gl_FragColor=vec4(col,a);
        #include <fog_fragment>
      }`,
  });
}

export interface StarRooftops { root: THREE.Group; update(time: number): void; counts: Record<string, number> }

/**
 * The roofline, doorsteps and the newcomers' house. `village` is the kit (for the pieces' extents), `rec` what
 * recordRooftops saw, `lots` the settlement's lots.
 */
export function starRooftops(village: Kit, rec: ReturnType<typeof recordRooftops>, lots: readonly Lot[], trail: {spots: readonly [number, number, number][]; height: (x: number, z: number) => number}): StarRooftops {
  const root = new THREE.Group(); root.name = 'star-rooftops';
  const silver = silverMaterial(), v = new THREE.Vector3(), w = new THREE.Vector3(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const lotAt = (p: THREE.Vector3) => lots.reduce((b, l) => Math.hypot(l.x - p.x, l.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? l : b);
  // Ridges: both ends and the middle of each roof, in world space.
  const ridges = rec.roofs.map(({name, m: rm}) => {
    const box = village.get(name).box, a = new THREE.Vector3(0, box.max.y - .05, box.min.z * .94).applyMatrix4(rm), b = new THREE.Vector3(0, box.max.y - .05, box.max.z * .94).applyMatrix4(rm);
    const mid = a.clone().add(b).multiplyScalar(.5);
    return {a, b, mid, lot: lotAt(mid), yaw: Math.atan2(b.x - a.x, b.z - a.z)};
  });
  const houses = ridges.filter((r) => r.lot.id.startsWith('star-home') || r.lot.id === 'star-tavern');
  const counts: Record<string, number> = {};

  // Crescent finials on both ends of every ridge.
  const fin = new THREE.InstancedMesh(finialGeometry(), silver, houses.length * 2); fin.name = 'star-roof-finials';
  const big = new THREE.Vector3(1.7, 1.7, 1.7);
  houses.forEach((r, i) => [r.a, r.b].forEach((p, k) => fin.setMatrixAt(i * 2 + k, m.compose(p, q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r.yaw + Math.PI / 2), big))));
  fin.castShadow = true; root.add(fin); counts.finials = fin.count;

  // The astronomer's observatory: a stone drum astride the ridge, a patinated copper dome with its slit open to the
  // north sky and a telescope's barrel out of it.
  const domeHouse = houses.find((r) => r.lot.id === STAR_ROOF_ROLES.dome);
  if (domeHouse) {
    const c = domeHouse.mid, toEcl = Math.atan2(STAR_ECLIPSE_DIR.x, STAR_ECLIPSE_DIR.z);
    const drum = new THREE.CylinderGeometry(1.25, 1.32, 1.3, 16, 1); drum.translate(0, .35, 0);
    const cornice = new THREE.CylinderGeometry(1.42, 1.42, .14, 16, 1); cornice.translate(0, 1.04, 0);
    const stone = new THREE.Mesh(lit([drum, cornice]), new THREE.MeshStandardMaterial({color: '#aeb2c6', roughness: .85, name: 'star-dome-drum'}));
    // Slit: a gap in the shell a sixth of the way round, from the base to just past the crown.
    const shell = new THREE.SphereGeometry(1.36, 24, 12, Math.PI * .58, Math.PI * 1.84, 0, Math.PI / 2); shell.translate(0, 1.1, 0);
    const dome = new THREE.Mesh(shell, new THREE.MeshStandardMaterial({color: '#4f8f88', metalness: .55, roughness: .42, side: THREE.DoubleSide, name: 'star-dome-copper'}));
    const inner = new THREE.Mesh(new THREE.SphereGeometry(1.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.1, 0), new THREE.MeshBasicMaterial({color: '#05060c', side: THREE.BackSide}));
    // Eight silver ribs from the dome's foot to its crown (quarter circles in vertical planes).
    const ribGeo = lit([0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const g = new THREE.TorusGeometry(1.37, .028, 4, 20, Math.PI / 2); g.rotateY(k / 8 * Math.PI * 2 + .4); return g; }));
    ribGeo.translate(0, 1.1, 0);
    const ribMesh = new THREE.Mesh(ribGeo, silver);
    const scope = new THREE.Mesh(telescopeGeometry(2.4, .62), new THREE.MeshStandardMaterial({color: '#b8955a', metalness: .8, roughness: .35, name: 'star-roof-brass'}));
    scope.position.set(0, .55, 0);
    const obs = new THREE.Group(); obs.name = 'star-observatory-dome';
    obs.add(stone, dome, inner, ribMesh, scope);
    // The slit faces the scope's aim, toward the eclipse.
    obs.position.set(c.x, c.y - .2, c.z); obs.rotation.y = toEcl; obs.scale.setScalar(1.35);
    for (const o of [stone, dome, ribMesh, scope]) { o.castShadow = true; o.receiveShadow = true; }
    root.add(obs); counts.dome = 1;
  }

  // Brass telescopes on a small platform at two ridges, aimed at the eclipse.
  {
    const list = houses.filter((r) => (STAR_ROOF_ROLES.telescopes as readonly string[]).includes(r.lot.id));
    const geo = telescopeGeometry(1.5, .45), deck = new THREE.CylinderGeometry(.75, .8, .12, 8);
    const scopes = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({color: '#b8955a', metalness: .8, roughness: .35, name: 'star-roof-brass'}), list.length); scopes.name = 'star-roof-telescopes';
    const decks = new THREE.InstancedMesh(deck, iron(), list.length); decks.name = 'star-roof-decks';
    const aim = Math.atan2(STAR_ECLIPSE_DIR.x, STAR_ECLIPSE_DIR.z);
    list.forEach((r, i) => {
      const p = r.a.clone().lerp(r.b, .3);
      decks.setMatrixAt(i, m.compose(v.set(p.x, p.y + .12, p.z), q.identity(), one));
      scopes.setMatrixAt(i, m.compose(v.set(p.x, p.y + .18, p.z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, aim + (i - .5) * .5), one));
    });
    scopes.castShadow = decks.castShadow = true; root.add(scopes, decks); counts.telescopes = list.length;
  }

  // Lanterns: one beside every door (on an iron bracket) and one on a pole on four ridges.
  const doors = starDoorLamps(lots);
  const ridgeLamps = houses.filter((r) => (STAR_ROOF_ROLES.ridgeLamps as readonly string[]).includes(r.lot.id));
  const {frame, glass} = lanternParts();
  const bracket = new THREE.BoxGeometry(.04, .04, .34); bracket.translate(0, .36, -.16);
  const pole = new THREE.CylinderGeometry(.03, .04, 1.1, 6); pole.translate(0, -.75, 0);
  const doorFrame = lit([frame.clone(), bracket]), poleFrame = lit([frame.clone(), pole]);
  // Trail posts: a crook-headed iron post, the lantern hung from its arm over the trail side.
  const post = new THREE.CylinderGeometry(.045, .07, 2.5, 6); post.translate(0, -1.0, -.42);
  const arm = new THREE.BoxGeometry(.04, .04, .46); arm.translate(0, .32, -.2);
  const foot = new THREE.CylinderGeometry(.16, .2, .18, 6); foot.translate(0, -2.16, -.42);
  const trailFrame = lit([frame.clone(), post, arm, foot]);
  const n = doors.length + ridgeLamps.length + trail.spots.length;
  const frames = new THREE.InstancedMesh(doorFrame, iron(), doors.length); frames.name = 'star-door-lantern-frames';
  const poles = new THREE.InstancedMesh(poleFrame, iron(), ridgeLamps.length); poles.name = 'star-ridge-lantern-frames';
  const glassMat = new THREE.MeshStandardMaterial({color: '#3a2412', emissive: '#ffb45e', emissiveIntensity: 2.4, roughness: .3, name: 'star-lantern-glass'});
  const panes = new THREE.InstancedMesh(glass, glassMat, n); panes.name = 'star-lantern-panes';
  doors.forEach((d, i) => {
    const p = doorLanternAt(d, v);
    m.compose(p, q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, d.yaw), one);frames.setMatrixAt(i, m);panes.setMatrixAt(i, m);
  });
  ridgeLamps.forEach((r, i) => {
    const p = r.a.clone().lerp(r.b, .72);
    m.compose(v.set(p.x, p.y + 1.25, p.z), q.identity(), one);poles.setMatrixAt(i, m);panes.setMatrixAt(doors.length + i, m);
  });
  const trailPosts = new THREE.InstancedMesh(trailFrame, iron(), trail.spots.length); trailPosts.name = 'star-trail-lantern-posts';
  trail.spots.forEach(([x, z, yaw], i) => {
    m.compose(v.set(x, trail.height(x, z) + 2.2, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), one);trailPosts.setMatrixAt(i, m);panes.setMatrixAt(doors.length + ridgeLamps.length + i, m);
  });
  counts.trailLanterns = trail.spots.length;
  frames.castShadow = poles.castShadow = trailPosts.castShadow = true; root.add(frames, poles, panes, trailPosts); counts.doorLanterns = doors.length; counts.ridgeLanterns = ridgeLamps.length;

  // Star-map banners beside the doors, on the side away from the lantern (not on the newcomers' empty house).
  {
    const list = doors.filter((d) => lotAt(d.pos).id !== STAR_ROOF_ROLES.empty);
    const geo = new THREE.PlaneGeometry(.8, 1.7, 1, 4); geo.translate(0, -.85, 0);
    const banners = new THREE.InstancedMesh(geo, bannerMaterial(), list.length); banners.name = 'star-map-banners';
    const rod = new THREE.InstancedMesh(lit([new THREE.CylinderGeometry(.025, .025, 1, 5).rotateZ(Math.PI / 2)]), iron(), list.length); rod.name = 'star-map-banner-rods';
    list.forEach((d, i) => {
      // The lantern is +1 m along the wall from the door's centre: the banner hangs at -1 m, a hand off the wall.
      const c = Math.cos(d.yaw), s = Math.sin(d.yaw);
      w.set(d.pos.x - c * 2.05 + s * .12, d.pos.y + .95, d.pos.z + s * 2.05 + c * .12);
      m.compose(w, q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, d.yaw), one);banners.setMatrixAt(i, m);
      m.compose(w.setY(w.y + .02), q, one);rod.setMatrixAt(i, m);
    });
    banners.castShadow = true; root.add(banners, rod); counts.banners = list.length;
  }

  // Chimney smoke.
  const smoke = smokeMaterial();
  {
    const per = 7, tops = rec.chimneys.map(({name, m: cm}) => new THREE.Vector3(0, village.get(name).box.max.y, 0).applyMatrix4(cm));
    const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1) as unknown as THREE.InstancedBufferGeometry);
    const phase = new Float32Array(tops.length * per);
    const puffs = new THREE.InstancedMesh(geo, smoke, tops.length * per); puffs.name = 'star-chimney-smoke';
    tops.forEach((t, i) => { for (let k = 0; k < per; k++) { phase[i * per + k] = k / per + i * .137; puffs.setMatrixAt(i * per + k, m.makeTranslation(t.x, t.y + .1, t.z)); } });
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    puffs.frustumCulled = false; puffs.renderOrder = 2; root.add(puffs); counts.smoke = tops.length;
  }
  return {root, counts, update(t) { (smoke.uniforms.sTime as {value: number}).value = t; }};
}

/**
 * The newcomers moving in: their cart before the empty house, piled and roped; crates, a chest and the chairs at the
 * door. Kit props go to the market's batch through `put` (x, z, yaw, scale, lift).
 */
export function starSettlers(lot: Lot, put: (name: string, x: number, z: number, yaw?: number, scale?: number, dy?: number) => void) {
  const f = lot.yaw, fx = Math.sin(f), fz = Math.cos(f), rx = Math.cos(f), rz = -Math.sin(f);
  // Local (right, out) from the house's front centre to world.
  const at = (r: number, o: number): [number, number] => [lot.x + fx * (lot.sz * 2 / 2 + o) + rx * r, lot.z + fz * (lot.sz * 2 / 2 + o) + rz * r];
  const P = (name: string, r: number, o: number, yaw = 0, s = 1, dy = 0) => { const [x, z] = at(r, o); put(name, x, z, f + yaw, s, dy); };
  // The cart, side on to the house, a little off the door.
  P('Stall_Cart_Empty', 2.6, 4.2, Math.PI / 2 + .12);
  // Its load: a table upside down, a chest, crates and a sack, stools on top.
  P('Crate_Wooden', 2.3, 4.0, .1, .9, .78);P('Crate_Wooden', 3.0, 4.4, -.2, .8, .78);P('Chest_Wood', 2.5, 4.3, .4, .9, 1.45);
  P('Stool', 2.9, 4.0, .3, 1, 1.5);P('Bag', 2.0, 4.5, 1, 1, .8);P('Barrel', 3.4, 3.9, 0, .8, .78);
  // At the door: crates stacked, a shelf leant to the wall, a table waiting, stools, a sack, rope.
  P('Crate_Wooden', -1.6, .9, .3);P('Crate_Wooden', -1.55, .95, .1, .85, .78);P('Crate_Wooden', -2.5, 1.2, -.4, .9);
  P('Shelf_Simple', -2.2, .35, Math.PI, .9);P('Table_Large', 1.6, 1.8, .5, .85);P('Stool', 1.0, 2.6, .9);P('Stool', 2.3, 1.4, 2.2, 1, 0);
  P('Bag', -.9, 1.6, .2);P('Rope_2', -2.5, 1.2, 0, 1, .82);P('Vase_2', 1.4, 1.6, 0, 1, .82);
}
