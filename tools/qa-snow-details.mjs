// Frostlight finishing details. (1) The guide motes read as round lantern points with no streak beside them: the
// guide's motes and their snow patches drawn alone in a gameplay still, one mote at a time (two motes overlapping on
// screen would otherwise merge into one wide blob), every blob no wider than 1.6 times its height. (2) No rainbow edge on the arena ice in a low view into the sun: the longest vertical run of yellow-green
// ice pixels (hues the ice, its glare and its runes never take) away from the rune strokes. (3) Every hung lantern's
// flame burns inside the kit lantern's cage, a drawn flame stands at each, and the cage matches the kit's vertices.
// (4) Sun-facing roof snow shows its relief: luma contrast of sunlit, sun-facing roof pixels at ripple and pillow
// scale, with no white blow-out. Zero page or shader errors, high and low quality. Writes tmp/qa/snow-details-*.png.
import assert from 'node:assert/strict';
import {launchBrowser} from './lib/browser.mjs';
import {mkdir} from 'node:fs/promises';
await mkdir('tmp/qa',{recursive:true});
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5230';
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
const errors=[];
async function load(quality){
 const p=await browser.newPage({viewport:{width:1600,height:900}});
 p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL/i.test(m.text()))errors.push(m.text().slice(0,300));});p.setDefaultTimeout(120000);
 await p.addInitScript(quality=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Details'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',quality);if(location.hostname==='127.0.0.1'){const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const u=new URL(String(url));if(u.pathname==='/multiplayer'){u.host=location.host;u.protocol='ws:';}super(u.href,protocols);}};}},quality);
 await p.goto(base+'/?screen=game');await p.locator('.launch-notice-start').click();await p.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:120000});
 await p.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;});await p.waitForTimeout(1000);
 await p.evaluate(c=>window.app.current.game.world2.go(c),4);
 await p.waitForFunction(()=>window.app.current.game.world2.chapter===4&&!document.querySelector('.loading'),null,{timeout:120000});await p.waitForTimeout(3000);
 // Only the canvas; a fixed camera when window.__cam is set; enemies and other crabs out of the frames.
 await p.evaluate(()=>{const c=window.app.engine.renderer.domElement;c.id='details-main';const s=document.createElement('style');s.textContent='body *{visibility:hidden!important}#details-main{visibility:visible!important}';document.head.appendChild(s);
  const g=window.app.current.game;g.follow.__orig=g.follow.update;g.follow.update=function(){const s=window.__cam;if(!s)return this.__orig.apply(this,arguments);this.camera.position.set(s.px,s.py,s.pz);this.camera.lookAt(s.tx,s.ty,s.tz);};
  const away=()=>{let i=0;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);for(const u of g.units)if(u!==g.player.unit){i++;if(Math.hypot(u.pos.x-210,u.pos.z-200-i*3)>1)u.teleport?.(g.world,210,200+i*3,0);}requestAnimationFrame(away);};away();});
 return p;
}
/** Fixed camera: target [x, z, height over ground] seen from [x, z, height over ground]; the player stands behind the eye. */
async function free(p,[tx,tz,tdy],[cx,cz,cdy]){
 await p.evaluate(([tx,tz,tdy,cx,cz,cdy])=>{const g=window.app.current.game,h=(x,z)=>g.world.heightAt(x,z),l=Math.hypot(cx-tx,cz-tz)||1;g.objectivePos=()=>null;
  g.player.unit.teleport(g.world,cx+(cx-tx)/l*4,cz+(cz-tz)/l*4,0);window.__cam={px:cx,py:h(cx,cz)+cdy,pz:cz,tx,ty:h(tx,tz)+tdy,tz};},[tx,tz,tdy,cx,cz,cdy]);
 await p.waitForTimeout(2400);
}
/** Gameplay camera behind the crab at (x, z), an objective at (tx, tz). */
async function guideView(p,[x,z],[tx,tz],pitch){
 await p.evaluate(([x,z,tx,tz,pitch])=>{const g=window.app.current.game,V=g.player.unit.pos.constructor,ty=g.world.heightAt(tx,tz);window.__cam=null;g.objectivePos=()=>new V(tx,ty,tz);
  const dx=tx-x,dz=tz-z,l=Math.hypot(dx,dz);g.player.unit.teleport(g.world,x,z,Math.atan2(dx,dz));g.follow.yaw=Math.atan2(-dx/l,-dz/l);g.follow.pitch=pitch;g.follow.distance=7.5;g.follow.cut();},[x,z,tx,tz,pitch]);
 await p.waitForTimeout(1800);
}
/** The live frame as luma and RGB arrays (decoded in the page). */
const FRAME=`async png=>{const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();const W=img.width,H=img.height,c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');x.drawImage(img,0,0);return {W,H,d:x.getImageData(0,0,W,H).data};}`;
/** A mesh's pixels in the live camera: rendered twice with only its material swapped; G carries a per-pixel value. */
const MASK=`async (meshName,valueGlsl,W,H)=>{const g=window.app.current.game,rd=window.app.engine.renderer,mesh=g.scene.getObjectByName(meshName);
 // The app's own three.js classes (a second copy of the module would warn): from the composer and any shader material.
 let SM=null;g.scene.traverse(o=>{if(!SM&&o.material&&o.material.type==='ShaderMaterial')SM=o.material.constructor;});
 const T={ShaderMaterial:SM,WebGLRenderTarget:window.app.engine.composer.inputBuffer.constructor,Vector3:g.camera.position.constructor};
 let light=null;g.scene.traverse(o=>{if(!light&&o.isDirectionalLight)light=o;});const sun=light.position.clone().sub(light.target.position).normalize();
 const mk=c=>new T.ShaderMaterial({uniforms:{uSun:{value:new T.Vector3(sun.x,sun.y,sun.z)},uC:{value:c}},vertexShader:'varying vec3 vN;varying vec3 vW;void main(){vN=normalize(mat3(modelMatrix)*normal);vW=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.);}',fragmentShader:'uniform vec3 uSun;uniform float uC;varying vec3 vN;varying vec3 vW;void main(){float v='+valueGlsl+';gl_FragColor=vec4(uC,clamp(v,0.,1.)*uC,0.,1.);}'});
 const rt=new T.WebGLRenderTarget(W,H),A=new Uint8Array(W*H*4),B=new Uint8Array(W*H*4),orig=mesh.material;
 mesh.material=mk(0);rd.setRenderTarget(rt);rd.render(g.scene,g.camera);rd.readRenderTargetPixels(rt,0,0,W,H,A);mesh.material=mk(1);rd.render(g.scene,g.camera);rd.readRenderTargetPixels(rt,0,0,W,H,B);
 mesh.material=orig;rd.setRenderTarget(null);rt.dispose();
 const m=new Uint8Array(W*H),v=new Float32Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x,j=((H-1-y)*W+x)*4;if(B[j]>200&&A[j]<50){m[i]=1;v[i]=B[j+1]/255;}}return {m,v};}`;

/** (1) Motes: part of the guide drawn alone over black (everything else hidden for the frame); its blobs above a luma. */
async function alone(p,parts,lumaMin,shot){
 await p.evaluate(parts=>{const g=window.app.current.game,fg=g.objective.frostGuide,scene=g.scene,keep=new Set();
  for(const o of parts.map(k=>fg[k])){let x=o;while(x){keep.add(x);x=x.parent;}}
  const saved=new Map();scene.traverse(o=>{if(o!==scene)saved.set(o,o.visible);});
  window.__iso={saved,bg:scene.background,hook:scene.onBeforeRender};scene.background=null;
  scene.onBeforeRender=()=>{scene.traverse(o=>{if(o===scene)return;if(!saved.has(o))saved.set(o,o.visible);o.visible=keep.has(o);});};},parts);
 await p.waitForTimeout(400);
 const png=(await p.screenshot({path:`tmp/qa/snow-details-motes-${shot}.png`})).toString('base64');
 const r=await p.evaluate(async([png,FRAME,lumaMin])=>{const F=await eval(FRAME)(png),{W,H,d}=F,N=W*H,m=new Uint8Array(N);
  for(let i=0;i<N;i++)m[i]=(.2126*d[i*4]+.7152*d[i*4+1]+.0722*d[i*4+2])>lumaMin?1:0;
  const lab=new Int32Array(N),out=[];let id=0;
  for(let s=0;s<N;s++){if(!m[s]||lab[s])continue;id++;let x0=1e9,x1=-1,y0=1e9,y1=-1,n=0;const st=[s];lab[s]=id;
   while(st.length){const i=st.pop(),x=i%W,y=(i-x)/W;n++;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
    for(const j of [i-1,i+1,i-W,i+W,i-W-1,i-W+1,i+W-1,i+W+1])if(j>=0&&j<N&&m[j]&&!lab[j]&&Math.abs((j%W)-x)<=1){lab[j]=id;st.push(j);}}
   if(n>=10)out.push({w:x1-x0+1,h:y1-y0+1,n});}
  return out;},[png,FRAME,lumaMin]);
 await p.evaluate(()=>{const g=window.app.current.game,scene=g.scene,s=window.__iso;scene.onBeforeRender=s.hook;scene.background=s.bg;for(const [o,v] of s.saved)o.visible=v;});
 return r.map(b=>({...b,aspect:+(b.w/b.h).toFixed(2)}));
}
/**
 * One mote at a time: after the guide's own update each frame, every other mote and its patch is put out, so each
 * mote's shape is judged alone wherever the path crosses the screen.
 */
const solo=(p,i)=>p.evaluate(i=>{const fg=window.app.current.game.objective.frostGuide;window.__solo=i;
 if(!fg.__solo){fg.__solo=true;const up=fg.update;fg.update=function(...a){up.apply(this,a);const k=window.__solo;if(k==null)return;const b=this.moteBright,c=this.patches.instanceColor;
  for(let j=0;j<b.count;j++)if(j!==k){b.setX(j,0);c.setX(j,0);}b.needsUpdate=true;c.needsUpdate=true;};}
 return fg.moteBright.count;},i);
/** Each mote alone (its bright core) and its snow patch alone, and the two together; blobs from every mote. */
async function moteBlobs(p,from,to,pitch,shot){
 await guideView(p,from,to,pitch);
 await p.screenshot({path:`tmp/qa/snow-details-motes-${shot}.png`});
 const n=await solo(p,null),out={motes:[],patches:[],both:[]};
 for(let i=0;i<n;i++){
  await solo(p,i);
  const m=await alone(p,['motes'],60,`${shot}-motes`);
  if(!m.length)continue;
  // The mote's own blob is its largest; anything else is its halo's fringe.
  out.motes.push(m.reduce((a,b)=>b.n>a.n?b:a));
  out.patches.push(...await alone(p,['patches'],12,`${shot}-patches`));
  out.both.push(...await alone(p,['motes','patches'],22,`${shot}-alone`));
 }
 await solo(p,null);
 return out;
}

/** (2) Rainbow on the ice: the longest vertical run, in any 12-pixel column band, of yellow-green ice pixels more than 6 px from a rune stroke. */
async function rainbow(p,target,eye,shot){
 await free(p,target,eye);
 const png=(await p.screenshot({path:`tmp/qa/snow-details-${shot}.png`})).toString('base64');
 return p.evaluate(async([png,FRAME,MASK])=>{const {W,H,d}=await eval(FRAME)(png),{m:ice}=await eval(MASK)('frostlight-arena-ice','1.',W,H),N=W*H;
  const hue=new Float32Array(N),sat=new Float32Array(N);
  for(let i=0;i<N;i++){const r=d[i*4]/255,g=d[i*4+1]/255,b=d[i*4+2]/255,mx=Math.max(r,g,b),mn=Math.min(r,g,b),c=Math.max(mx-mn,1e-5);sat[i]=(mx-mn)/Math.max(mx,1e-3);
   hue[i]=(mx===r?(((g-b)/c)%6+6)%6:mx===g?(b-r)/c+2:(r-g)/c+4)*60;}
  const teal=new Uint8Array(N);for(let i=0;i<N;i++)teal[i]=hue[i]>175&&hue[i]<215&&sat[i]>.12?1:0;
  // Dilate the rune strokes by 6 px (separable max).
  const R=6,t1=new Uint8Array(N),t2=new Uint8Array(N);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){let v=0;for(let k=-R;k<=R&&!v;k++){const xx=x+k;if(xx>=0&&xx<W&&teal[y*W+xx])v=1;}t1[y*W+x]=v;}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){let v=0;for(let k=-R;k<=R&&!v;k++){const yy=y+k;if(yy>=0&&yy<H&&t1[yy*W+x])v=1;}t2[y*W+x]=v;}
  let icePx=0,odd=0;const bad=new Uint8Array(N);
  for(let i=0;i<N;i++){if(!ice[i])continue;icePx++;if(hue[i]>45&&hue[i]<170&&sat[i]>.035&&!t2[i]){bad[i]=1;odd++;}}
  let run=0,at=0;
  for(let c=0;c+12<=W;c+=6){let r=0;for(let y=0;y<H;y++){let v=0;for(let k=0;k<12;k++)if(bad[y*W+c+k]){v=1;break;}r=v?r+1:0;if(r>run){run=r;at=c;}}}
  return {icePx,odd,run,at};},[png,FRAME,MASK]);
}

/** (4) Sunlit, sun-facing roof snow: luma contrast at ripple scale (pixel minus a 5 px blur) and pillow scale (5 px blur minus a 29 px blur). */
async function roofRelief(p,target,eye,shot){
 await free(p,target,eye);
 const png=(await p.screenshot({path:`tmp/qa/snow-details-${shot}.png`})).toString('base64');
 return p.evaluate(async([png,FRAME,MASK])=>{const {W,H,d}=await eval(FRAME)(png),{m:roof,v:nl}=await eval(MASK)('frostlight-roof-snow','max(dot(normalize(vN),uSun),0.)',W,H),N=W*H;
  const L=new Float32Array(N);for(let i=0;i<N;i++)L[i]=(.2126*d[i*4]+.7152*d[i*4+1]+.0722*d[i*4+2])/255;
  const facing=[];for(let i=0;i<N;i++)if(roof[i]&&nl[i]>.5)facing.push(L[i]);facing.sort((a,b)=>a-b);const p75=facing[Math.floor(facing.length*.75)]??1;
  // Sunlit: not under a chimney's or a neighbour's shadow.
  const sun=new Uint8Array(N);for(let i=0;i<N;i++)sun[i]=roof[i]&&nl[i]>.5&&L[i]>=p75*.8?1:0;
  const er=new Uint8Array(N),R=3;for(let y=R;y<H-R;y++)for(let x=R;x<W-R;x++){const i=y*W+x;if(!sun[i])continue;let ok=1;for(let k=-R;k<=R&&ok;k++)if(!sun[i+k]||!sun[i+k*W])ok=0;er[i]=ok;}
  const box=(a,r,horiz)=>{const o=new Float32Array(N);if(horiz){for(let y=0;y<H;y++){let s=0;const r0=y*W;for(let x=-r;x<W;x++){if(x+r<W)s+=a[r0+x+r];if(x-r-1>=0)s-=a[r0+x-r-1];if(x>=0)o[r0+x]=s;}}}else{for(let x=0;x<W;x++){let s=0;for(let y=-r;y<H;y++){if(y+r<H)s+=a[(y+r)*W+x];if(y-r-1>=0)s-=a[(y-r-1)*W+x];if(y>=0)o[y*W+x]=s;}}}return o;};
  const nblur=r=>{let v=new Float32Array(N),w=new Float32Array(N);for(let i=0;i<N;i++){v[i]=sun[i]?L[i]:0;w[i]=sun[i];}for(let k=0;k<2;k++){v=box(box(v,r,true),r,false);w=box(box(w,r,true),r,false);}const o=new Float32Array(N);for(let i=0;i<N;i++)o[i]=w[i]>1e-6?v[i]/w[i]:0;return o;};
  const b5=nblur(2),b29=nblur(14);let n=0,a1=0,a2=0,c1=0,c2=0,mean=0,blown=0;
  for(let i=0;i<N;i++){if(!er[i])continue;n++;const a=L[i]-b5[i],c=b5[i]-b29[i];a1+=a;a2+=a*a;c1+=c;c2+=c*c;mean+=L[i];if(L[i]>=250/255)blown++;}
  const sd=(s,ss)=>+(Math.sqrt(Math.max(0,ss/n-(s/n)**2))*255).toFixed(2);
  return {px:n,ripple:sd(a1,a2),pillow:sd(c1,c2),mean:+(mean/n*255).toFixed(1),blown:+(blown/n*100).toFixed(2)};},[png,FRAME,MASK]);
}

/** (3) Lanterns: the cage against the kit's vertices; each noted flame inside its cage and a drawn flame at it. */
const lanterns=p=>p.evaluate(async()=>{
 const g=window.app.current.game,V=g.camera.position.constructor,M=g.camera.matrixWorld.constructor;
 const {LANTERN_CAGE:C,LANTERN_FLAME:F}=await import('/src/game/frostLantern.ts'),{loadKit}=await import('/src/world/kit.ts');
 const kit=await loadKit('/models/world/props.glb'),lo=[1e9,1e9,1e9],hi=[-1e9,-1e9,-1e9];
 for(const part of kit.get('Lantern_Wall').parts){const a=part.geometry.getAttribute('position');for(let i=0;i<a.count;i++){const v=[a.getX(i),a.getY(i),a.getZ(i)];if(v[1]<.62&&v[2]>.45)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],v[k]);hi[k]=Math.max(hi[k],v[k]);}}}
 const cageErr=Math.max(...[0,1,2].map(k=>Math.max(Math.abs(lo[k]-C.min.getComponent(k)),Math.abs(hi[k]-C.max.getComponent(k)))));
 const notes=[];g.scene.traverse(o=>{for(const l of o.userData.lanterns??[])notes.push({...l,holder:o.name});});
 // Drawn flames: the village's merged flame mesh, the lamp-post quest flames, and fire tongues (points).
 const drawn=[],v=new V();
 g.scene.traverse(o=>{if(!(o.isMesh&&/lantern-flames$|^frostlight-guide-flame-/.test(o.name))&&!(o.isPoints&&/-tongues$/.test(o.name)))return;o.updateMatrixWorld(true);const a=o.geometry.getAttribute('position');for(let i=0;i<a.count;i++)drawn.push(v.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld).toArray());});
 const shrink=.03,bad=[],orphan=[],holders={};
 for(const l of notes){
  holders[l.holder]=(holders[l.holder]??0)+1;
  const inv=new M().fromArray(l.m).invert(),q=new V(...l.flame).applyMatrix4(inv);
  const inside=q.x>C.min.x+shrink&&q.x<C.max.x-shrink&&q.y>C.min.y+shrink&&q.y<C.max.y-shrink&&q.z>C.min.z+shrink&&q.z<C.max.z-shrink;
  if(!inside||q.distanceTo(F)>1e-3)bad.push({holder:l.holder,local:q.toArray().map(x=>+x.toFixed(3))});
  if(!drawn.some(d=>Math.hypot(d[0]-l.flame[0],d[2]-l.flame[2])<.1&&Math.abs(d[1]-l.flame[1])<.25))orphan.push({holder:l.holder,flame:l.flame.map(x=>+x.toFixed(2))});
 }
 return {count:notes.length,holders,cageErr:+cageErr.toFixed(4),bad:bad.slice(0,5),badCount:bad.length,orphan:orphan.slice(0,5),orphanCount:orphan.length};
});

const VIEWS={
 hearth:[[26,67.5,1.2],[20.5,66,1.8]],
 arenaLow:[[8,-66,0],[-6,-94,2.2]],
 arenaLow2:[[-4,-70,0],[10,-97,1.4]],
 villageHigh:[[0,58,2],[22,92,30]],
 aerialLow:[[0,56,0],[34,96,42]],
};
// DETAILS_ONLY=lanterns,motes,arena,roofs runs a subset (to show a baseline failing); DETAILS_QUALITY=high one quality.
const only=process.env.DETAILS_ONLY?.split(','),run=k=>!only||only.includes(k);
try{
 for(const quality of process.env.DETAILS_QUALITY?.split(',')??['high','low']){
  const p=await load(quality),q=quality==='high'?'':'-low';
  if(run('lanterns')){
  const lamp=await lanterns(p);
  assert.ok(lamp.count>=30,`hung lanterns noted: ${JSON.stringify(lamp)}`);
  assert.ok(lamp.cageErr<.005,`the cage box matches the kit's Lantern_Wall vertices: ${lamp.cageErr}`);
  assert.equal(lamp.badCount,0,`every flame inside its lantern's cage: ${JSON.stringify(lamp.bad)}`);
  assert.equal(lamp.orphanCount,0,`a drawn flame at every lantern: ${JSON.stringify(lamp.orphan)}`);
  console.log(`PASS ${quality} lanterns`,JSON.stringify(lamp));
  }
  await free(p,...VIEWS.hearth);await p.screenshot({path:`tmp/qa/snow-details-hearth${q}.png`});

  if(run('motes'))for(const [shot,from,to,pitch] of [['street',[0,45],[-7,26],.18],['field',[20,12],[44,-6],.22]]){
   const b=await moteBlobs(p,from,to,pitch,shot+q),max=a=>a.length?Math.max(...a.map(x=>x.aspect)):0;
   const v={motes:b.motes.length,moteAspect:max(b.motes),patchBlobs:b.patches.length,patchAspect:max(b.patches),bothAspect:max(b.both)};
   assert.ok(v.patchAspect<=2.5,`${shot}: no snow patch drawn as a thin horizontal streak: ${JSON.stringify(v)} ${JSON.stringify(b.patches)}`);
   assert.ok(v.bothAspect<=1.6,`${shot}: motes and patches together, no blob wider than 1.6 x its height: ${JSON.stringify(v)}`);
   assert.ok(v.motes>=3,`${shot}: at least three motes drawn, each its own point: ${JSON.stringify(v)}`);
   assert.ok(v.moteAspect<=1.25,`${shot}: each mote is a round or upright point (width <= 1.25 x height): ${JSON.stringify(b.motes)}`);
   console.log(`PASS ${quality} motes ${shot}`,JSON.stringify(v));
  }

  if(run('arena'))for(const [shot,view] of [['arena-sun-low',VIEWS.arenaLow],['arena-sun-low2',VIEWS.arenaLow2]]){
   const r=await rainbow(p,...view,shot+q);
   assert.ok(r.icePx>100000,`${shot}: the ice fills the view: ${JSON.stringify(r)}`);
   assert.ok(r.run<=55,`${shot}: no rainbow streak on the ice (vertical run <= 55 px): ${JSON.stringify(r)}`);
   console.log(`PASS ${quality} arena ${shot}`,JSON.stringify(r));
  }

  if(run('roofs'))for(const [shot,view] of [['village-high',VIEWS.villageHigh],['aerial-low',VIEWS.aerialLow]]){
   const r=await roofRelief(p,...view,shot+q);
   assert.ok(r.px>50000,`${shot}: sunlit sun-facing roof pixels: ${JSON.stringify(r)}`);
   assert.ok(r.ripple>=2.6&&r.pillow>=2.4,`${shot}: sun-facing roof snow shows its relief: ${JSON.stringify(r)}`);
   assert.ok(r.mean>=190&&r.mean<=222&&r.blown<=.5,`${shot}: sunlit roof snow stays white without blowing out: ${JSON.stringify(r)}`);
   console.log(`PASS ${quality} roofs ${shot}`,JSON.stringify(r));
  }
  await p.close();
 }
 assert.deepEqual(errors,[],'no page or shader errors');
 console.log('PASS zero errors');
}finally{await browser.close();}
