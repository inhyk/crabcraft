// Frostlight's glacier ice, the citadel's stone and the arena's powder, measured in the judges' views (capture2's
// cameras). (1) The big spires are not uniform slabs: inside the spire mask (wild-east: the field spires; arena: the
// spires, pillars and citadel ice) the luma spread, the chroma spread and the local detail (pixel against a 9 px
// blur). (2) The crystals break the single prism: folds, ledges, breaks and shards (triangles per crystal, shards round
// the big feet), the attributes the chord-through-the-body shading and the ridge glints read. (3) The castle wall is
// not one repeated tile: in the landmark view, inside the granite mask, the stones' own values against the joint
// grid. (4) The arena's powder is not cut out: the thin-powder share of the ice and the relief inside the drifts, the
// runes still shining. Zero page or shader errors, high and low quality.
// Thresholds sit between base147 (PR #147 head, before this lane) and this branch, measured 2026-10-21 in both
// qualities (base / branch): spire detail 2.05-2.13 / 3.34-4.28, luma spread 11.9-12.2 / 18.5-22.2, chroma spread
// 13.7-14.0 / 24.2-27.0; stones per grid 1.40-1.43 / 1.56-1.60, grid 5.17-5.27 / 4.81-4.94; powder thin share
// .140-.141 / .280-.286, drift relief 7.95-8.10 / 11.6-11.8.
// CC_QA_BASELINE=<url> also measures a baseline and prints it. Writes tmp/qa/snow-ice-*.png.
import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(url,quality){
 const p=await browser.newPage({viewport:{width:1600,height:900}});
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(120000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Ice'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(url+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;});await p.waitForTimeout(1000);
 await p.evaluate(c=>window.app.current.game.world2.go(c),4);
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===4&&!document.querySelector('.loading')&&!!window.app.current.game.world2.fourth.village,null,{timeout:180000});await p.waitForTimeout(3000);
 // Only the canvas; capture2's orbit camera when window.__cam is set; enemies and other crabs out of the frames.
 await p.evaluate(()=>{const c=window.app.engine.renderer.domElement;c.id='ice-main';const s=document.createElement('style');s.textContent='body *{visibility:hidden!important}#ice-main{visibility:visible!important}';document.head.appendChild(s);
  const g=window.app.current.game;g.objectivePos=()=>null;g.follow.__orig=g.follow.update;g.follow.update=function(){const s=window.__cam;if(!s)return this.__orig.apply(this,arguments);const cp=Math.cos(s.pitch);this.camera.position.set(s.tx+Math.sin(s.yaw)*cp*s.dist,s.ty+Math.sin(s.pitch)*s.dist,s.tz+Math.cos(s.yaw)*cp*s.dist);this.camera.lookAt(s.tx,s.ty,s.tz);};
  const away=()=>{let i=0;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);for(const u of g.units)if(u!==g.player.unit){i++;if(Math.hypot(u.pos.x-210,u.pos.z-200-i*3)>1)u.teleport?.(g.world,210,200+i*3,0);}requestAnimationFrame(away);};away();});
 return p;
}
// capture2.mjs's views: target x, z, yaw, pitch, distance.
const VIEW={'wild-east':[45,-15,-.6,.28,22],landmark:[0,-45,0,.3,26],arena:[0,-75,0,.5,34]};
async function view(p,name,shot){
 const [x,z,yaw,pitch,dist]=VIEW[name];
 await p.evaluate(([x,z,yaw,pitch,dist])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,yaw+Math.PI);const u=g.player.unit.pos;window.__cam={tx:u.x,ty:u.y+1.2,tz:u.z,yaw,pitch,dist};},[x,z,yaw,pitch,dist]);
 await p.waitForTimeout(2600);
 return (await p.screenshot({path:`tmp/qa/snow-ice-${shot}.png`})).toString('base64');
}
/** The live frame as RGBA (decoded in the page). */
const FRAME=`async png=>{const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();const W=img.width,H=img.height,c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');x.drawImage(img,0,0);return {W,H,d:x.getImageData(0,0,W,H).data};}`;
/** The pixels of the named meshes in the live camera: the scene rendered twice with only their material swapped. */
const MASK=`async (names,W,H)=>{const g=window.app.current.game,rd=window.app.engine.renderer,meshes=[];g.scene.traverse(o=>{if(o.isMesh&&names.includes(o.name)&&o.visible)meshes.push(o);});
 let SM=null;g.scene.traverse(o=>{if(!SM&&o.material&&o.material.type==='ShaderMaterial')SM=o.material.constructor;});
 const RT=window.app.engine.composer.inputBuffer.constructor;
 const mk=c=>new SM({uniforms:{uC:{value:c}},vertexShader:'void main(){gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.);}',fragmentShader:'uniform float uC;void main(){gl_FragColor=vec4(uC,0.,0.,1.);}'});
 const rt=new RT(W,H),A=new Uint8Array(W*H*4),B=new Uint8Array(W*H*4),orig=meshes.map(m=>m.material),m0=mk(0),m1=mk(1);
 meshes.forEach(m=>m.material=m0);rd.setRenderTarget(rt);rd.render(g.scene,g.camera);rd.readRenderTargetPixels(rt,0,0,W,H,A);meshes.forEach(m=>m.material=m1);rd.render(g.scene,g.camera);rd.readRenderTargetPixels(rt,0,0,W,H,B);
 meshes.forEach((m,i)=>m.material=orig[i]);rd.setRenderTarget(null);rt.dispose();m0.dispose();m1.dispose();
 const m=new Uint8Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const j=((H-1-y)*W+x)*4;if(B[j]>200&&A[j]<50)m[y*W+x]=1;}return m;}`;
/** Shared helpers, evaluated in the page: luma, erosion, a masked box blur. */
const LIB=`({
 luma:(d,N)=>{const L=new Float32Array(N);for(let i=0;i<N;i++)L[i]=(.2126*d[i*4]+.7152*d[i*4+1]+.0722*d[i*4+2])/255;return L;},
 erode:(m,W,H,R)=>{const o=new Uint8Array(W*H);for(let y=R;y<H-R;y++)for(let x=R;x<W-R;x++){const i=y*W+x;if(!m[i])continue;let ok=1;for(let k=-R;k<=R&&ok;k++)if(!m[i+k]||!m[i+k*W])ok=0;o[i]=ok;}return o;},
 blur:(a,m,W,H,r)=>{const N=W*H,box=(v,horiz)=>{const o=new Float32Array(N);if(horiz){for(let y=0;y<H;y++){let s=0;const r0=y*W;for(let x=-r;x<W;x++){if(x+r<W)s+=v[r0+x+r];if(x-r-1>=0)s-=v[r0+x-r-1];if(x>=0)o[r0+x]=s;}}}else{for(let x=0;x<W;x++){let s=0;for(let y=-r;y<H;y++){if(y+r<H)s+=v[(y+r)*W+x];if(y-r-1>=0)s-=v[(y-r-1)*W+x];if(y>=0)o[y*W+x]=s;}}}return o;};
  const v=new Float32Array(N),w=new Float32Array(N);for(let i=0;i<N;i++){v[i]=m[i]?a[i]:0;w[i]=m[i];}const bv=box(box(v,true),false),bw=box(box(w,true),false),o=new Float32Array(N);for(let i=0;i<N;i++)o[i]=bw[i]>1e-6?bv[i]/bw[i]:0;return o;},
})`;

/** (1) Inside the spire mask: luma and chroma spread, and the local detail (mean |pixel - 9 px blur|), all x 255. */
async function spires(p,png,names){
 return p.evaluate(async([png,FRAME,MASK,LIB,names])=>{const {W,H,d}=await eval(FRAME)(png),N=W*H,U=eval(LIB),m0=await eval(MASK)(names,W,H),m=U.erode(m0,W,H,2),L=U.luma(d,N),b=U.blur(L,m,W,H,4);
  let n=0,s=0,ss=0,cb=0,cr=0,cbb=0,crr=0,det=0;
  for(let i=0;i<N;i++){if(!m[i])continue;n++;const l=L[i],r=d[i*4]/255,bl=d[i*4+2]/255,u=bl-l,v=r-l;s+=l;ss+=l*l;cb+=u;cr+=v;cbb+=u*u;crr+=v*v;det+=Math.abs(l-b[i]);}
  const sd=(a,aa)=>Math.sqrt(Math.max(0,aa/n-(a/n)**2))*255;
  return {px:n,luma:+(s/n*255).toFixed(1),lumaSpread:+sd(s,ss).toFixed(2),chromaSpread:+Math.hypot(sd(cb,cbb),sd(cr,crr)).toFixed(2),detail:+(det/n*255).toFixed(2)};},[png,FRAME,MASK,LIB,names]);
}
/**
 * (3) The wall as a repeated tile: a grid of joint lines over stones of one value. Inside the granite mask, the fine
 * grid's energy (mean |pixel - 5 px box|, the joints are one or two pixels) against the spread of the stones' own
 * values (a 9 px box, which swallows the joints, against a 41 px box, which follows the light).
 */
async function wall(p,png){
 return p.evaluate(async([png,FRAME,MASK,LIB])=>{const {W,H,d}=await eval(FRAME)(png),N=W*H,U=eval(LIB),m=U.erode(await eval(MASK)(['frostlight-citadel-granite','frostlight-citadel-granite-far'],W,H),W,H,1),L=U.luma(d,N);
  const b2=U.blur(L,m,W,H,2),b4=U.blur(L,m,W,H,4),b20=U.blur(L,m,W,H,20);
  let n=0,grid=0,sv=0,sv2=0;for(let i=0;i<N;i++)if(m[i]){n++;grid+=Math.abs(L[i]-b2[i]);const v=b4[i]-b20[i];sv+=v;sv2+=v*v;}
  const stone=Math.sqrt(Math.max(0,sv2/n-(sv/n)**2))*255;grid=grid/n*255;
  return {px:n,grid:+grid.toFixed(2),stoneSpread:+stone.toFixed(2),stonePerGrid:+(stone/grid).toFixed(3)};},[png,FRAME,MASK,LIB]);
}
/**
 * (4) Arena powder as cut-out shapes: a flat white fill with an outline, over bare ice. On the ice, the share of
 * pixels in the thin-powder band (luma .42 to .58: the drift thinning, the sifted dusting) and the luma spread inside
 * the drifts (snow pixels three in from their edge). Rune strokes and their glow (bright, saturated, blue over red),
 * dilated by 3 px, are neither ice nor snow; they are counted to show the runes still shine.
 */
async function powder(p,png){
 return p.evaluate(async([png,FRAME,MASK,LIB])=>{const {W,H,d}=await eval(FRAME)(png),N=W*H,U=eval(LIB),ice=U.erode(await eval(MASK)(['frostlight-arena-ice'],W,H),W,H,3),L=U.luma(d,N);
  const glow=new Uint8Array(N);for(let i=0;i<N;i++){const r=d[i*4],g=d[i*4+1],b=d[i*4+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b);if(mx>90&&(mx-mn)/mx>.4&&b>r+30)glow[i]=1;}
  const R=3,g1=new Uint8Array(N),g2=new Uint8Array(N);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){let v=0;for(let k=-R;k<=R&&!v;k++){const xx=x+k;if(xx>=0&&xx<W&&glow[y*W+xx])v=1;}g1[y*W+x]=v;}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){let v=0;for(let k=-R;k<=R&&!v;k++){const yy=y+k;if(yy>=0&&yy<H&&g1[yy*W+x])v=1;}g2[y*W+x]=v;}
  let icePx=0,snow=0,part=0,runes=0;const HI=.55,sn=new Uint8Array(N);
  for(let i=0;i<N;i++){if(glow[i]&&ice[i])runes++;if(!ice[i]||g2[i])continue;icePx++;const l=L[i];if(l>=HI){snow++;sn[i]=1;}if(l>=.42&&l<.58)part++;}
  // Inside the drifts (snow pixels three in from any edge): a flat fill is a cut-out, a laid drift has relief.
  const core=U.erode(sn,W,H,3);let c=0,s=0,ss=0;for(let i=0;i<N;i++)if(core[i]){c++;s+=L[i];ss+=L[i]*L[i];}
  return {icePx,snow,snowShare:+(snow/icePx).toFixed(3),partialShare:+(part/icePx).toFixed(3),interiorStd:+(Math.sqrt(Math.max(0,ss/c-(s/c)**2))*255).toFixed(2),runes};},[png,FRAME,MASK,LIB]);
}
/** (2) Structure: the crystal meshes' shape and attributes, the shaders' quality switches. */
const structure=p=>p.evaluate(()=>{const w=window.app.current.game.world2.fourth,info=n=>{const m=w.root.getObjectByName(n);if(!m)return null;const g=m.geometry,a=n=>!!g.getAttribute(n);
  // A crystal's 'aSeed' is constant over its facets: count crystals and their triangles.
  const seeds=g.getAttribute('aSeed'),dims=g.getAttribute('aDim'),tri=new Map();for(let i=0;i<seeds.count;i+=3){const k=seeds.getX(i).toFixed(5);tri.set(k,(tri.get(k)??0)+1);}
  // Big: past the icicle size (iceCrystals.ts SMALL_H, SMALL_R). Shards: short and leaning far out (the satellites lean less).
  let big=0,bigTri=0,shards=0;const ax=g.getAttribute('aAxis');
  if(dims){const seen=new Set();for(let i=0;i<seeds.count;i+=3){const k=seeds.getX(i).toFixed(5);if(seen.has(k))continue;seen.add(k);const r=dims.getX(i),h=dims.getY(i);if(h>=1.1&&r>=.16){big++;bigTri+=tri.get(k);}if(h<4&&ax.getY(i)<.8)shards++;}}
  return {crystals:tri.size,triangles:seeds.count/3,big,bigTriMean:big?+(bigTri/big).toFixed(1):0,shards,attrs:['aRoot','aAxis','aDim','aEdge'].filter(a)};};
 const arena=w.root.getObjectByName('frostlight-arena-ice');
 return {cliffs:info('frostlight-ice-cliffs'),citadel:info('frostlight-citadel-ice'),iceDetail:w.iceGlass.uniforms.iceDetail?.value,quality:window.app.engine.quality,
  programs:window.app.engine.renderer.info.programs.map(q=>q.cacheKey).filter(k=>/frostlight-(masonry|arena-ice)/.test(k)).length};});

async function measure(url,quality,tag){
 const p=await load(url,quality),q=quality==='low'?'-low':'';
 const st=await structure(p);
 const east=await spires(p,await view(p,'wild-east',`${tag}wild-east${q}`),['frostlight-ice-cliffs']);
 const pngA=await view(p,'arena',`${tag}arena${q}`);
 const arena=await spires(p,pngA,['frostlight-ice-cliffs','frostlight-citadel-ice']),pow=await powder(p,pngA);
 const stone=await wall(p,await view(p,'landmark',`${tag}landmark${q}`));
 await p.close();
 return {st,east,arena,pow,stone};
}
try{
 if(process.env.CC_QA_BASELINE){const b=await measure(process.env.CC_QA_BASELINE,'high','base-');console.log('BASELINE',JSON.stringify(b));}
 for(const quality of ['high','low']){
  const r=await measure(base,quality,'');
  console.log(quality.toUpperCase(),JSON.stringify(r));
  const {st,east,arena,pow,stone}=r;
  // (2) Shape and shading.
  for(const [n,c] of [['cliffs',st.cliffs],['citadel',st.citadel]]){
   assert.deepEqual(c.attrs,['aRoot','aAxis','aDim','aEdge'],`${n}: the crystals carry their root, axis, size and ridge flags`);
   assert.ok(c.bigTriMean>=28,`${n}: big crystals fold, step and snap instead of one 18-triangle prism: ${JSON.stringify(c)}`);
  }
  assert.ok(st.cliffs.shards>=120,`shards broken off round the big feet: ${JSON.stringify(st.cliffs)}`);
  assert.equal(st.iceDetail,quality==='low'?0:1,'the ice drops its inner samples on low quality');
  assert.ok(st.programs>=2,'masonry and arena ice shaders compiled');
  console.log(`PASS ${quality} crystals: cliffs ${st.cliffs.crystals} (${st.cliffs.big} big at ${st.cliffs.bigTriMean} triangles, ${st.cliffs.shards} shards), citadel ${st.citadel.crystals} (${st.citadel.bigTriMean})`);
  // (1) Inner variation in the judges' views.
  for(const [n,s] of [['wild-east',east],['arena',arena]]){
   assert.ok(s.px>40000,`${n}: the spires fill part of the view: ${JSON.stringify(s)}`);
   assert.ok(s.detail>=2.7,`${n}: the spires carry inner detail (|pixel - 9 px blur| >= 2.7): ${JSON.stringify(s)}`);
   assert.ok(s.lumaSpread>=16,`${n}: thin edges, deep cores and veils spread the spires' values: ${JSON.stringify(s)}`);
   assert.ok(s.chromaSpread>=19.5,`${n}: pale rims, deep cores and three kinds of ice spread their colour: ${JSON.stringify(s)}`);
  }
  console.log(`PASS ${quality} spires vary inside: wild-east ${JSON.stringify(east)}, arena ${JSON.stringify(arena)}`);
  // (3) The wall.
  assert.ok(stone.px>20000,`the citadel's stone fills the landmark view: ${JSON.stringify(stone)}`);
  assert.ok(stone.stonePerGrid>=1.5,`the stones' own values carry the wall, not a grid of joints: ${JSON.stringify(stone)}`);
  assert.ok(stone.grid<=5.05,`the joint grid is quieter than a tile's: ${JSON.stringify(stone)}`);
  console.log(`PASS ${quality} wall breaks its repeat: ${JSON.stringify(stone)}`);
  // (4) The arena powder.
  assert.ok(pow.icePx>150000,`the arena ice fills the view: ${JSON.stringify(pow)}`);
  assert.ok(pow.snowShare>=.08&&pow.snowShare<=.3,`powder lies on part of the ice: ${JSON.stringify(pow)}`);
  assert.ok(pow.partialShare>=.21,`the drifts thin into powder and dusting instead of a cut edge: ${JSON.stringify(pow)}`);
  assert.ok(pow.interiorStd>=9.8,`the drifts carry relief (tongues, crests, packed and sifted), not a flat fill: ${JSON.stringify(pow)}`);
  assert.ok(pow.runes>=120000,`the runes shine clear of the powder: ${JSON.stringify(pow)}`);
  console.log(`PASS ${quality} arena powder: ${JSON.stringify(pow)}`);
 }
 assert.deepEqual(errors,[],'no page or shader errors');
 console.log('PASS zero page or shader errors');
}finally{await browser.close();}
