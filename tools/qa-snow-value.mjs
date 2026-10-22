// Frostlight value and finish in the judges' views (capture2's village, street, arena and aerial cameras).
// (1) Roofs: sunlit roof snow a clear value step over the sunlit ground snow, few sunlit roof edges that melt into
// sunlit ground (neither a step nor a darker line between them), no white blow-out. (2) Aerial: the frame keeps its
// contrast (luma spread, a dark anchor), the frozen sea reads darker than the island, and the sea and the coast stay
// soft (the top percentiles of the gradient after a 9 px blur, which leaves shape edges and drops texture). (3) The quest shaft is still in the village and street frames but
// takes a small share of them and does not run from the snow to the frame's top. (4) The guide motes over the arena
// ice are glows with their image in the ice: a bright core in a soft falloff, upright or round, no flat disc under
// them. High and low quality, zero page or shader errors.
// VALUE_REPORT=1 prints the numbers without asserting (to measure a baseline). Writes tmp/qa/snow-value-*.png.
import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230',report=!!process.env.VALUE_REPORT;
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){
 const p=await browser.newPage({viewport:{width:1600,height:900}});
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.text().startsWith('dbg'))console.log(m.text());});p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(120000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Value'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;});await p.waitForTimeout(1000);
 await p.evaluate(c=>window.app.current.game.world2.go(c),4);
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===4&&!document.querySelector('.loading'),null,{timeout:120000});await p.waitForTimeout(3000);
 // Only the canvas; capture2's orbit camera round the crab; the objective the judges' frames show (the lantern by the
 // north gate); enemies and other crabs out of the frames.
 await p.evaluate(()=>{const c=window.app.engine.renderer.domElement;c.id='value-main';const s=document.createElement('style');s.textContent='body *{visibility:hidden!important}#value-main{visibility:visible!important}';document.head.appendChild(s);
  const g=window.app.current.game,V=g.player.unit.pos.constructor;g.objectivePos=()=>new V(-3.8,g.world.heightAt(-3.8,31.4),31.4);
  g.follow.__orig=g.follow.update;g.follow.update=function(){const s=window.__cam;if(!s)return this.__orig.apply(this,arguments);const cp=Math.cos(s.pitch);this.camera.position.set(s.tx+Math.sin(s.yaw)*cp*s.dist,s.ty+Math.sin(s.pitch)*s.dist,s.tz+Math.cos(s.yaw)*cp*s.dist);this.camera.lookAt(s.tx,s.ty,s.tz);};
  const away=()=>{let i=0;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);for(const u of g.units)if(u!==g.player.unit){i++;if(Math.hypot(u.pos.x-210,u.pos.z-200-i*3)>1)u.teleport?.(g.world,210,200+i*3,0);}requestAnimationFrame(away);};away();});
 return p;
}
/** capture2.mjs's views: [x, z, yaw, pitch, distance], the crab at (x, z), the camera orbiting it. */
const VIEWS={village:[0,55,.5,.5,40],street:[0,45,.3,.12,9],arena:[0,-75,0,.5,34],aerial:[0,0,0,1.25,180]};
async function view(p,name){
 await p.evaluate(([x,z,yaw,pitch,dist])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,yaw+Math.PI);const u=g.player.unit.pos;window.__cam={tx:u.x,ty:u.y+1.2,tz:u.z,yaw,pitch,dist};},VIEWS[name]);
 await p.waitForTimeout(2600);
}
/** The live frame as RGB (decoded in the page). */
const FRAME=`async png=>{const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();const W=img.width,H=img.height,c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');x.drawImage(img,0,0);return {W,H,d:x.getImageData(0,0,W,H).data};}`;
/**
 * Masks in the live camera, rendered without post: `roof` (the cap mesh, its material swapped for two flat colours;
 * G carries how square it faces the sun) and `ground` (pixels that change when the clipmap is hidden).
 */
const MASKS=`async (W,H)=>{const g=window.app.current.game,rd=window.app.engine.renderer,mesh=g.scene.getObjectByName('frostlight-roof-snow'),ground=g.scene.getObjectByName('snowdrift-terrain');
 let SM=null;g.scene.traverse(o=>{if(!SM&&o.material&&o.material.type==='ShaderMaterial')SM=o.material.constructor;});
 const T={ShaderMaterial:SM,WebGLRenderTarget:window.app.engine.composer.inputBuffer.constructor,Vector3:g.camera.position.constructor};
 let light=null;g.scene.traverse(o=>{if(!light&&o.isDirectionalLight)light=o;});const sun=light.position.clone().sub(light.target.position).normalize();
 const mk=c=>new T.ShaderMaterial({uniforms:{uSun:{value:new T.Vector3(sun.x,sun.y,sun.z)},uC:{value:c}},vertexShader:'varying vec3 vN;void main(){vN=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.);}',fragmentShader:'uniform vec3 uSun;uniform float uC;varying vec3 vN;void main(){gl_FragColor=vec4(uC,clamp(dot(normalize(vN),uSun),0.,1.)*uC,0.,1.);}'});
 // Float, so the linear HDR frame does not clip to white before the hidden clipmap's pixels are compared.
 const rt=new T.WebGLRenderTarget(W,H,{type:1015}),A=new Float32Array(W*H*4),B=new Float32Array(W*H*4),orig=mesh.material;
 rd.setRenderTarget(rt);
 mesh.material=mk(0);rd.render(g.scene,g.camera);rd.readRenderTargetPixels(rt,0,0,W,H,A);mesh.material=mk(1);rd.render(g.scene,g.camera);rd.readRenderTargetPixels(rt,0,0,W,H,B);mesh.material=orig;
 const roof=new Uint8Array(W*H),nl=new Float32Array(W*H);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,j=((H-1-y)*W+x)*4;if(B[j]>.8&&A[j]<.2){roof[i]=1;nl[i]=B[j+1];}}
 rd.render(g.scene,g.camera);rd.readRenderTargetPixels(rt,0,0,W,H,A);ground.visible=false;rd.render(g.scene,g.camera);rd.readRenderTargetPixels(rt,0,0,W,H,B);ground.visible=true;
 rd.setRenderTarget(null);rt.dispose();
 const gm=new Uint8Array(W*H);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,j=((H-1-y)*W+x)*4;const a=A[j]+A[j+1]+A[j+2],b=B[j]+B[j+1]+B[j+2];if(!roof[i]&&Math.abs(A[j]-B[j])+Math.abs(A[j+1]-B[j+1])+Math.abs(A[j+2]-B[j+2])>.03*(a+b)+1e-3)gm[i]=1;}
 // Each pixel's ray onto the sea's plane (y = 0.42): the coast ellipse's radius there (snowGround.ts; 1 on the
 // coast's curve, the sea flat past about 0.92).
 g.camera.updateMatrixWorld();const proj=g.camera.projectionMatrixInverse.elements,world=g.camera.matrixWorld.elements;
 const m=(e,v)=>[e[0]*v[0]+e[4]*v[1]+e[8]*v[2]+e[12]*v[3],e[1]*v[0]+e[5]*v[1]+e[9]*v[2]+e[13]*v[3],e[2]*v[0]+e[6]*v[1]+e[10]*v[2]+e[14]*v[3],e[3]*v[0]+e[7]*v[1]+e[11]*v[2]+e[15]*v[3]];
 const eye=[world[12],world[13],world[14]],rr=new Float32Array(W*H);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){let v=m(proj,[(x+.5)/W*2-1,1-(y+.5)/H*2,1,1]);v=[v[0]/v[3],v[1]/v[3],v[2]/v[3],0];v=m(world,v);const t=(.42-eye[1])/v[1];
  rr[y*W+x]=t>0?Math.hypot((eye[0]+v[0]*t)/128,(eye[2]+v[2]*t-2)/155):0;}
 return {roof,nl,ground:gm,rr};}`;

/** (1) Roof snow against the ground snow. */
async function roofs(p,shot){
 const png=(await p.screenshot({path:`tmp/qa/snow-value-${shot}.png`})).toString('base64');
 return p.evaluate(async([png,FRAME,MASKS])=>{const {W,H,d}=await eval(FRAME)(png),{roof,nl,ground:g0,rr}=await eval(MASKS)(W,H),N=W*H,ground=g0.map((v,i)=>v&&rr[i]<.9?1:0);
  const L=new Float32Array(N);for(let i=0;i<N;i++)L[i]=.2126*d[i*4]+.7152*d[i*4+1]+.0722*d[i*4+2];
  const pct=(a,q)=>{if(!a.length)return 0;const s=Float32Array.from(a).sort();return s[Math.min(s.length-1,Math.floor(s.length*q))];};
  const facing=[];for(let i=0;i<N;i++)if(roof[i]&&nl[i]>.5)facing.push(L[i]);const r75=pct(facing,.75);
  const lit=[],litI=[],blown=[0,0];for(let i=0;i<N;i++)if(roof[i]&&nl[i]>.5&&L[i]>=r75*.8){lit.push(L[i]);litI.push(i);blown[0]++;if(L[i]>=250)blown[1]++;}
  const gl=[];for(let i=0;i<N;i++)if(ground[i])gl.push(L[i]);const g90=pct(gl,.9),glit=gl.filter(v=>v>=g90*.85),glitI=[];for(let i=0;i<N;i++)if(ground[i]&&L[i]>=g90*.85)glitI.push(i);
  // CIELAB of each set's median colour: the step in lightness and in temperature (b*, yellow over blue) together.
  const lab=ix=>{const c=[0,1,2].map(k=>pct(ix.map(i=>d[i*4+k]),.5)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
   const X=(.4124*c[0]+.3576*c[1]+.1805*c[2])/.9505,Y=.2126*c[0]+.7152*c[1]+.0722*c[2],Z=(.0193*c[0]+.1192*c[1]+.9505*c[2])/1.089,f=t=>t>.008856?Math.cbrt(t):7.787*t+16/116;
   return [116*f(Y)-16,500*(f(X)-f(Y)),200*(f(Y)-f(Z))];};
  const lr=lab(litI),lg=lab(glitI),dE=Math.hypot(lr[0]-lg[0],lr[1]-lg[1],lr[2]-lg[2]);
  // The outline where a roof could melt into the ground: every roof edge pixel with sunlit ground within 12 px
  // outward (8 directions, the first that hits) and sunlit roof 6 to 10 px inward. The roof's value less the ground's
  // is the step; the outline is how much darker than both the pixels between them run, from 3 px inside the edge (the
  // cap's cool turn, the drip edge) to 2 px into the ground (the eave board, the cornice's shade). An edge melts where
  // neither shows by 12 levels.
  const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]],lines=[],steps=[];let melt=0,bright=0;
  for(let y=12;y<H-12;y++)for(let x=12;x<W-12;x++){const i=y*W+x;if(!roof[i]||(roof[i-1]&&roof[i+1]&&roof[i-W]&&roof[i+W]))continue;
   for(const [dx,dy] of dirs){let hit=-1;for(let k=1;k<=12;k++){const j=(y+dy*k)*W+x+dx*k;if(roof[j])break;if(ground[j]){hit=k;break;}}
    if(hit<0)continue;
    let s=0,n=0;for(let k=6;k<=10;k++){const j=(y-dy*k)*W+x-dx*k;if(!roof[j]){n=0;break;}s+=L[j];n++;}
    let gs=0,gn=0;for(let k=hit;k<=hit+3;k++){const xx=x+dx*k,yy=y+dy*k;if(xx<0||yy<0||xx>=W||yy>=H)break;const j=yy*W+xx;if(ground[j]){gs+=L[j];gn++;}}
    if(!n||!gn)break;
    const r=s/n,gv=gs/gn;
    let mn=1e9;for(let k=-3;k<=hit+2;k++)mn=Math.min(mn,L[(y+dy*k)*W+x+dx*k]);
    if(r>=r75*.8&&gv>=g90*.85){bright++;const line=Math.min(r,gv)-mn;lines.push(line);steps.push(r-gv);if(r-gv<12&&line<12)melt++;}
    break;}}
  return {roofPx:lit.length,roofL:+pct(lit,.5).toFixed(1),groundPx:glit.length,groundL:+pct(glit,.5).toFixed(1),step:+(pct(lit,.5)-pct(glit,.5)).toFixed(1),dL:+(lr[0]-lg[0]).toFixed(1),db:+(lr[2]-lg[2]).toFixed(1),dE:+dE.toFixed(1),
   edges:bright,edgeStep:+pct(steps,.5).toFixed(1),line:+pct(lines,.5).toFixed(1),melt:+(melt/Math.max(1,bright)*100).toFixed(1),blown:+(blown[1]/Math.max(1,blown[0])*100).toFixed(2)};},[png,FRAME,MASKS]);
}

/** (2) The aerial: the frame's contrast, the sea against the island, and the hardest edge on the sea and the coast. */
async function aerial(p,shot){
 const png=(await p.screenshot({path:`tmp/qa/snow-value-${shot}.png`})).toString('base64');
 return p.evaluate(async([png,FRAME,MASKS])=>{const {W,H,d}=await eval(FRAME)(png),{ground,rr}=await eval(MASKS)(W,H),N=W*H;
  const L=new Float32Array(N);let s=0,ss=0,sat=0;for(let i=0;i<N;i++){const r=d[i*4],g=d[i*4+1],b=d[i*4+2];L[i]=.2126*r+.7152*g+.0722*b;s+=L[i];ss+=L[i]*L[i];const mx=Math.max(r,g,b),mn=Math.min(r,g,b);sat+=mx>0?(mx-mn)/mx:0;}
  const pct=(a,q)=>{if(!a.length)return 0;const t=Float32Array.from(a).sort();return t[Math.min(t.length-1,Math.floor(t.length*q))];};
  // Gradient of a 9 px box blur: an edge that survives the blur is a hard shape edge (a cast shadow's cut, a coast's
  // rim), not the floes' seams and leads, a few pixels wide at this height.
  const R=4,T=new Float32Array(N),B=new Float32Array(N);
  for(let y=0;y<H;y++)for(let x=R;x<W-R;x++){let a=0;for(let u=-R;u<=R;u++)a+=L[y*W+x+u];T[y*W+x]=a/(2*R+1);}
  for(let y=R;y<H-R;y++)for(let x=0;x<W;x++){let a=0;for(let v=-R;v<=R;v++)a+=T[(y+v)*W+x];B[y*W+x]=a/(2*R+1);}
  const seaG=[],coastG=[],seaL=[],landL=[],hard=[0,0];
  for(let y=2*R;y<H-2*R;y++)for(let x=2*R;x<W-2*R;x++){const i=y*W+x;if(!ground[i]&&rr[i]<1.02)continue;const gx=B[i+R]-B[i-R],gy=B[i+R*W]-B[i-R*W],gm=Math.hypot(gx,gy)/(2*R);
   if(rr[i]>1.02){seaG.push(gm);if(gm>=4)hard[0]++;}if(rr[i]>.82&&rr[i]<1.02){coastG.push(gm);if(gm>=4)hard[1]++;}if(rr[i]<.75)landL.push(L[i]);}
  // The sea by the ray alone: the hazed sea of old matched the sky's own haze, which the ground mask cannot tell apart.
  for(let i=0;i<N;i++)if(rr[i]>1.1)seaL.push(L[i]);
  const mean=s/N;
  return {std:+Math.sqrt(ss/N-mean*mean).toFixed(1),p5:+pct(L,.05).toFixed(1),p95:+pct(L,.95).toFixed(1),sat:+(sat/N).toFixed(3),
   seaPx:seaL.length,seaL:+pct(seaL,.5).toFixed(1),landL:+pct(landL,.5).toFixed(1),seaEdge:+pct(seaG,.995).toFixed(2),coastEdge:+pct(coastG,.99).toFixed(2),seaHard:hard[0],coastHard:hard[1]};},[png,FRAME,MASKS]);
}

/** Parts of the guide drawn alone over black for one frame (everything else hidden), as a screenshot. */
async function alone(p,parts,shot){
 await p.evaluate(parts=>{const g=window.app.current.game,fg=g.objective.frostGuide,scene=g.scene,keep=new Set();
  for(const o of parts.map(k=>fg[k])){let x=o;while(x){keep.add(x);x=x.parent;}}
  const saved=new Map();scene.traverse(o=>{if(o!==scene)saved.set(o,o.visible);});
  window.__iso={saved,bg:scene.background,hook:scene.onBeforeRender};scene.background=null;
  scene.onBeforeRender=()=>{scene.traverse(o=>{if(o===scene)return;if(!saved.has(o))saved.set(o,o.visible);o.visible=keep.has(o);});};},parts);
 await p.waitForTimeout(400);
 const png=(await p.screenshot({path:`tmp/qa/snow-value-${shot}.png`})).toString('base64');
 await p.evaluate(()=>{const g=window.app.current.game,scene=g.scene,s=window.__iso;scene.onBeforeRender=s.hook;scene.background=s.bg;for(const [o,v] of s.saved)o.visible=v;});
 return png;
}
/** (3) The shaft alone: its share of the frame, and how much of the frame's height it spans. */
async function shaft(p,shot){
 await p.screenshot({path:`tmp/qa/snow-value-${shot}.png`});
 const png=await alone(p,['shaft'],`${shot}-shaft`);
 return p.evaluate(async([png,FRAME])=>{const {W,H,d}=await eval(FRAME)(png),N=W*H;let lit=0,rows=0;
  for(let y=0;y<H;y++){let r=0;for(let x=0;x<W;x++){const i=y*W+x,l=.2126*d[i*4]+.7152*d[i*4+1]+.0722*d[i*4+2];if(l>14)lit++;if(l>40)r++;}if(r>=3)rows++;}
  return {share:+(lit/N*100).toFixed(2),rows:+(rows/H).toFixed(3)};},[png,FRAME]);
}
/**
 * (4) Motes and their light on the arena ice, alone (their images in the ice included): per blob over the ice, the
 * bright core's share of its falloff. A blob is over the ice when its centre's ray meets the ice's plane inside its rim.
 */
async function motes(p,shot){
 await p.screenshot({path:`tmp/qa/snow-value-${shot}.png`});
 const png=await alone(p,['motes','patches','images'],`${shot}-motes`);
 return p.evaluate(async([png,FRAME])=>{const {W,H,d}=await eval(FRAME)(png),N=W*H,L=new Float32Array(N),m=new Uint8Array(N);
  for(let i=0;i<N;i++){L[i]=.2126*d[i*4]+.7152*d[i*4+1]+.0722*d[i*4+2];m[i]=L[i]>8?1:0;}
  const g=window.app.current.game;g.camera.updateMatrixWorld();const proj=g.camera.projectionMatrixInverse.elements,world=g.camera.matrixWorld.elements;
  const mul=(e,v)=>[e[0]*v[0]+e[4]*v[1]+e[8]*v[2]+e[12]*v[3],e[1]*v[0]+e[5]*v[1]+e[9]*v[2]+e[13]*v[3],e[2]*v[0]+e[6]*v[1]+e[10]*v[2]+e[14]*v[3],e[3]*v[0]+e[7]*v[1]+e[11]*v[2]+e[15]*v[3]];
  const ice=g.scene.getObjectByName('frostlight-arena-ice'),iy=ice.position.y,ix=ice.position.x,iz=ice.position.z;
  const onIce=(x,y)=>{let v=mul(proj,[(x+.5)/W*2-1,1-(y+.5)/H*2,1,1]);v=mul(world,[v[0]/v[3],v[1]/v[3],v[2]/v[3],0]);const t=(iy-world[13])/v[1];return t>0&&Math.hypot(world[12]+v[0]*t-ix,world[14]+v[2]*t-iz)<21.5;};
  const lab=new Int32Array(N),out=[];let id=0;
  for(let s=0;s<N;s++){if(!m[s]||lab[s])continue;id++;const px=[s];lab[s]=id;let peak=0,x0=1e9,x1=-1,y0=1e9,y1=-1,sx=0,sy=0;
   for(let k=0;k<px.length;k++){const i=px[k],x=i%W,y=(i-x)/W;peak=Math.max(peak,L[i]);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);sx+=x;sy+=y;
    for(const j of [i-1,i+1,i-W,i+W])if(j>=0&&j<N&&m[j]&&!lab[j]&&Math.abs((j%W)-x)<=1){lab[j]=id;px.push(j);}}
   if(px.length<30)continue;let core=0,halo=0;for(const i of px){if(L[i]>peak*.5)core++;if(L[i]>peak*.1)halo++;}
   out.push({n:px.length,peak:+peak.toFixed(0),core:+(core/Math.max(1,halo)).toFixed(2),aspect:+((x1-x0+1)/(y1-y0+1)).toFixed(2),ice:onIce(sx/px.length,sy/px.length)});}
  return out;},[png,FRAME]);
}

// VALUE_ONLY=roofs,aerial,shaft,motes runs a subset; VALUE_QUALITY=high one quality.
// Bounds on the blurred gradient's top percentiles: the floes, leads and the soft coast shadows stay soft. (PR #147's
// one hard cut, the citadel's shadow on the sea, is a single line too short to move a percentile; the sheet shows it.)
const SEA_EDGE=4.5,COAST_EDGE=7.5;
const only=process.env.VALUE_ONLY?.split(','),run=k=>!only||only.includes(k);
const results={};
try{
 for(const quality of process.env.VALUE_QUALITY?.split(',')??['high','low']){
  const p=await load(quality),q=quality==='high'?'':'-low',R=results[quality]={};
  // Townsfolk and drifting snow cross the roof edges: three frames, the one with the median melt counts.
  if(run('roofs'))for(const v of ['village','aerial']){await view(p,v);const t=[];for(let i=0;i<3;i++){t.push(await roofs(p,`roofs-${v}${q}${i?`-${i}`:''}`));await p.waitForTimeout(400);}R[`roofs-${v}`]=t.sort((a,b)=>a.melt-b.melt)[1];}
  if(run('aerial')){await view(p,'aerial');R.aerial=await aerial(p,`aerial${q}`);}
  if(run('shaft'))for(const v of ['village','street']){await view(p,v);R[`shaft-${v}`]=await shaft(p,`shaft-${v}${q}`);}
  // Motes drift along the way and two can overlap on screen for a moment: three frames, the median worst one counts.
  if(run('motes')){await view(p,'arena');const t=[];for(let i=0;i<3;i++){t.push(await motes(p,`arena${q}${i?`-${i}`:''}`));await p.waitForTimeout(400);}
   const worst=m=>Math.max(...m.map(b=>Math.max(b.aspect,b.core*2.6)));R.motes=t.sort((a,b)=>worst(a)-worst(b))[1];}
  console.log(quality,JSON.stringify(R));
  if(!report){
   if(run('roofs'))for(const v of ['village','aerial']){const r=R[`roofs-${v}`];
    assert.ok(r.roofPx>(v==='village'?40000:2000)&&r.groundPx>2000,`${v}: roof and ground in the frame: ${JSON.stringify(r)}`);
    // Measured 2026-10-22 over 3 to 7 runs each, dev 5cacbe9 / this branch, both qualities: village step 5.9-14.8 /
    // 28.8-30.4, melt (high) 26.9-29.1 / 12.4-21.3; aerial step 20.1-24.7 / 25.0-27.5, melt 16-19 / 10.3-17. The
    // village view tells the two apart; the aerial's few hundred roof pixels only guard against falling back.
    assert.ok(r.step>=(v==='village'?22:23.5),`${v}: sunlit roof snow a value step over the sunlit ground: ${JSON.stringify(r)}`);
    assert.ok(r.edges>=40&&r.melt<=(v==='village'?24:19),`${v}: few sunlit roof edges melt into the sunlit ground: ${JSON.stringify(r)}`);
    assert.ok(r.roofL<=228&&r.blown<=.5,`${v}: roof snow stays below white: ${JSON.stringify(r)}`);
    console.log(`PASS ${quality} roofs ${v}`,JSON.stringify(r));}
   if(run('aerial')){const a=R.aerial;
   assert.ok(a.std>=30&&a.p5<=105,`aerial: contrast and a dark anchor: ${JSON.stringify(a)}`);
   assert.ok(a.seaPx>50000&&a.landL-a.seaL>=12,`aerial: the frozen sea reads darker than the island: ${JSON.stringify(a)}`);
   assert.ok(a.seaEdge<=SEA_EDGE&&a.coastEdge<=COAST_EDGE,`aerial: the sea and the coast stay soft: ${JSON.stringify(a)}`);
   console.log(`PASS ${quality} aerial`,JSON.stringify(a));}
   if(run('shaft'))for(const v of ['village','street']){const s=R[`shaft-${v}`];
    assert.ok(s.share>=.2,`${v}: the shaft still shows: ${JSON.stringify(s)}`);
    assert.ok(s.share<=(v==='village'?.8:2.5)&&s.rows<=(v==='village'?.3:.45),`${v}: the shaft is a light, not a stripe through the frame: ${JSON.stringify(s)}`);
    console.log(`PASS ${quality} shaft ${v}`,JSON.stringify(s));}
   if(run('motes')){const m=R.motes.filter(b=>b.ice);
   assert.ok(m.length>=3,`arena: motes drawn over the ice: ${JSON.stringify(R.motes)}`);
   // A gaussian glow puts 0.3 of its falloff in its core, a flat disc nearly all of it.
   assert.ok(m.every(b=>b.core<=.45&&b.aspect<=1.2),`arena: each mote over the ice a glow, upright or round, no flat disc under it: ${JSON.stringify(m)}`);
   console.log(`PASS ${quality} motes`,JSON.stringify(m));}
  }
  await p.close();
 }
 assert.deepEqual(errors,[],'no page or shader errors');
 console.log('PASS zero errors');
}finally{await browser.close();}
