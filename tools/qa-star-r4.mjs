// World II fourth round: the eclipse lights the world. (1) Totality's horizon: the sky dome 1.5 degrees up is a warm
// orange-rose glow in every direction (red over blue and well over green, even in the moon's quarter where its
// halo cools it), and 12 degrees up it is the night blue again. (2) The corona:
// four to six radial streamers round the disc, reaching 2 to 3 disc radii, the light falling steeply from the limb.
// (3) No vertical light pillar over the goal in World II (the shared beam stays hidden, nothing tall and thin and
// glowing stands there): a ring on the ground and motes rising out of it instead. (4) The sanctum floor's outer band
// has no bright filled plates (its silver share is thin glyph lines). (5) Fields: mean CIELAB L* of the standard east
// and west views is not below the 14394b7 build's, and the meadow has its three large-scale values (lush, plain,
// worn) over real areas. Zero page and shader errors at high and low quality.
// Usage: CC_QA_BASE=http://127.0.0.1:5623 node tools/qa-star-r4.mjs
//   CC_QA_BEFORE=http://127.0.0.1:5633 also measures the field L* on a before build (else the recorded 14394b7 numbers).
//   QA_METRICS_ONLY=1 prints the numbers without asserting.
import {launchBrowser} from './lib/browser.mjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5623',before=process.env.CC_QA_BEFORE,metricsOnly=!!process.env.QA_METRICS_ONLY;
/** 14394b7's field L* in the same views (tmp/cap.mjs east and west, 1600x900, crab in frame, no HUD). */
const BEFORE_L={east:16.56,west:22.66};
await mkdir('tmp/qa',{recursive:true});
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
async function open(url,quality){
  const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL|GL_|THREE/i.test(m.text()))errors.push(m.text().slice(0,300));});
  page.setDefaultTimeout(180000);
  await page.addInitScript(q=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'Shots'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.language','ko');localStorage.setItem('cc.quality',q);},quality);
  await page.goto(url+'/?screen=game');await page.locator('.launch-notice-start').click();
  await page.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:180000});
  await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.player.nextSwing=Infinity;g.creatorTravel=true;});await page.waitForTimeout(1000);
  await page.evaluate(()=>window.app.current.game.world2.go(2));
  await page.waitForFunction(()=>window.app.current.game.world2.chapter===2&&!document.querySelector('.loading'),null,{timeout:180000});
  await page.waitForTimeout(3000);
  await page.evaluate(()=>{const c=window.app.engine.renderer.domElement;c.id='qa-main';const s=document.createElement('style');s.textContent='body *{visibility:hidden!important}#qa-main{visibility:visible!important}';document.head.appendChild(s);
    const g=window.app.current.game;
    g.follow.__orig=g.follow.update;g.follow.update=function(){const s=window.__cam;if(!s)return this.__orig.apply(this,arguments);const cp=Math.cos(s.pitch);this.camera.position.set(s.tx+Math.sin(s.yaw)*cp*s.dist,s.ty+Math.sin(s.pitch)*s.dist,s.tz+Math.cos(s.yaw)*cp*s.dist);this.camera.lookAt(s.tx,s.ty,s.tz);};
    const away=()=>{let i=0;for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);for(const u of g.units)if(u!==g.player.unit){i++;if(Math.hypot(u.pos.x-210,u.pos.z-200-i*3)>1)u.teleport?.(g.world,210,200+i*3,0);}requestAnimationFrame(away);};away();});
  return {page,errors};
}
const view=async(page,[x,z,yaw,pitch,dist])=>{await page.evaluate(([x,z,yaw,pitch,dist])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,yaw+Math.PI);const u=g.player.unit.pos;window.__cam={tx:u.x,ty:u.y+1.2,tz:u.z,yaw,pitch,dist};},[x,z,yaw,pitch,dist]);await page.waitForTimeout(2600);};
/** Mean CIELAB L* of the frame (sRGB, D65), decoded in the page. */
async function meanL(page,path){
  const png=(await page.screenshot({path})).toString('base64');
  return page.evaluate(async png=>{const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);
    const d=x.getImageData(0,0,c.width,c.height).data,lin=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;},T=new Float64Array(256).map((_,i)=>lin(i));
    let s=0,n=0;for(let i=0;i<d.length;i+=4){const Y=.2126*T[d[i]]+.7152*T[d[i+1]]+.0722*T[d[i+2]];s+=Y>.008856?116*Math.cbrt(Y)-16:903.3*Y;n++;}return s/n;},png);
}
const FIELD_VIEWS={east:[60,-5,-1.57,.3,26],west:[-60,-5,1.57,.3,26]};
async function fieldL(url){const {page,errors}=await open(url,'high');const out={};for(const [k,v] of Object.entries(FIELD_VIEWS)){await view(page,v);out[k]=await meanL(page,`tmp/qa/star-r4-${k}${url===base?'':'-before'}.png`);}await page.close();return {L:out,errors};}

const m={};
try{
  const {page,errors}=await open(base,'high');
  // (1), (2): the sky dome alone, rendered linear into a float target from its centre, sampled along exact directions.
  Object.assign(m,await page.evaluate(()=>{
    const g=window.app.current.game,w=g.world2,rd=window.app.engine.renderer,sky=w.sky.root,dome=sky.getObjectByName('star-aurora-dome');
    const T={Scene:g.scene.constructor,Cam:g.camera.constructor,RT:window.app.engine.composer.inputBuffer.constructor,V:g.camera.position.constructor};
    const scene=new T.Scene(),cam=new T.Cam(1,1,.1,2000),N=64,rt=new T.RT(N,N,{type:1015}),buf=new Float32Array(N*N*4);
    const parent=dome.parent;scene.add(dome);const pos=dome.position.clone();dome.position.set(0,0,0);dome.updateMatrixWorld();
    const shot=(dir,fov)=>{cam.fov=fov;cam.updateProjectionMatrix();cam.position.set(0,0,0);cam.up.set(0,1,0);cam.lookAt(dir.x,dir.y,dir.z);cam.updateMatrixWorld();rd.setRenderTarget(rt);rd.render(scene,cam);rd.readRenderTargetPixels(rt,0,0,N,N,buf);rd.setRenderTarget(null);return buf;};
    const at=(b,x,y)=>{const o=(Math.round(y)*N+Math.round(x))*4;return [b[o],b[o+1],b[o+2]];};
    // Horizon: eight bearings, 1.5 and 12 degrees up (a 2-degree frame, its centre).
    const band=[];for(let k=0;k<8;k++){const az=k/8*Math.PI*2;const row=[];for(const alt of [1.5,12]){const a=alt*Math.PI/180;const b=shot(new T.V(Math.sin(az)*Math.cos(a),Math.sin(a),Math.cos(az)*Math.cos(a)),2);row.push(at(b,N/2,N/2));}band.push(row);}
    // Corona: the dome's eclipse light alone (its own GLSL, nothing else of the sky), a frame of +-4 disc radii round
    // the eclipse, sampled by disc radius and position angle.
    const skyMat=dome.material,only=skyMat.clone();only.fragmentShader=skyMat.fragmentShader.replace(/void main\(\)\{[\s\S]*\}\s*$/,'void main(){gl_FragColor=vec4(starEclipseLight(starEclipseAt(normalize(direction)),time,true),1.);}');only.uniforms=skyMat.uniforms;dome.material=only;
    const R=3.4*Math.PI/180,E=new T.V(-.045,Math.tan(7.5*Math.PI/180),-1).normalize();
    const fov=2*Math.atan(Math.tan(4*R))*180/Math.PI,b=shot(E,fov);
    // Screen axes of the frame: right and up of the camera.
    const right=new T.V().setFromMatrixColumn(cam.matrixWorld,0),up=new T.V().setFromMatrixColumn(cam.matrixWorld,1),fwd=E.clone();
    const L=(rr,pa)=>{const t=Math.tan(rr*R);const d=fwd.clone().addScaledVector(right,Math.cos(pa)*t).addScaledVector(up,Math.sin(pa)*t);const px=(d.dot(right)/d.dot(fwd))/Math.tan(4*R)*N/2+N/2,py=(d.dot(up)/d.dot(fwd))/Math.tan(4*R)*N/2+N/2;if(px<0||py<0||px>N-1||py>N-1)return 0;const c=at(b,px,py);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
    const A=180,ring=rr=>{const v=[];for(let i=0;i<A;i++)v.push(L(rr,i/A*Math.PI*2));return v;};
    const med=a=>{const s=[...a].sort((x,y)=>x-y);return s[s.length>>1];};
    // Streamers at 1.7 radii: smoothed profile peaks (the highest within 16 degrees) standing at least 1.8 times over
    // the lowest point within 30 degrees and 2.5 times over the ring's darkest tenth.
    const p=ring(1.7),sm=p.map((_,i)=>{let s=0;for(let k=-3;k<=3;k++)s+=p[(i+k+A)%A];return s/7;}),p10=[...sm].sort((x,y)=>x-y)[Math.floor(A*.1)];
    const peaks=[];for(let i=0;i<A;i++){const v=sm[i];let top=true,lo=v;for(let k=-15;k<=15;k++){const u=sm[(i+k+A)%A];if(k&&Math.abs(k)<=8&&u>v)top=false;lo=Math.min(lo,u);}if(top&&v>p10*2.5&&v>lo*1.8)peaks.push(i*2);}
    // Extent: the farthest radius whose brightest point is still 2% of the limb's light.
    const limb=med(ring(1.03));let extent=1;for(let rr=1.1;rr<=3.9;rr+=.05){if(Math.max(...ring(rr))>limb*.02)extent=rr;}
    const fall=med(ring(1.15))/Math.max(med(ring(2)),1e-6);
    dome.material=skyMat;only.dispose();
    scene.remove(dome);parent.add(dome);dome.position.copy(pos);rt.dispose();
    return {band,prof:sm.filter((_,i)=>i%5===0).map(v=>+v.toFixed(3)),corona:{peaks,extent:+extent.toFixed(2),fall:+fall.toFixed(2),limb:+limb.toFixed(3)}};
  }));
  console.log('horizon (8 bearings: [r,g,b] at 1.5 and 12 degrees)',JSON.stringify(m.band.map(r=>r.map(c=>c.map(v=>+v.toFixed(3))))));
  console.log('corona',JSON.stringify(m.corona));if(process.env.QA_DEBUG)console.log('profile',JSON.stringify(m.prof));

  // (3): a goal north-east of the crab; the shared beam hidden, nothing tall, thin and glowing in the scene; ring and motes.
  await page.evaluate(()=>{const g=window.app.current.game,V=g.player.unit.pos.constructor;g.objectivePos=()=>new V(0,g.world.heightAt(0,-20),-20);});
  await view(page,[0,-2,0,.22,26]);
  await page.screenshot({path:'tmp/qa/star-r4-goal.png'});
  m.goal=await page.evaluate(()=>{
    const g=window.app.current.game,o=g.objective,tall=[];
    g.scene.updateMatrixWorld(true);
    g.scene.traverse(x=>{if(!x.isMesh||!x.geometry)return;let v=true;for(let p=x;p;p=p.parent)if(!p.visible){v=false;break;}if(!v)return;const mat=x.material;if(!mat||mat.blending!==2||!mat.transparent)return;
      x.geometry.computeBoundingBox?.();const bb=x.geometry.boundingBox.clone().applyMatrix4(x.matrixWorld);const h=bb.max.y-bb.min.y,wd=Math.max(bb.max.x-bb.min.x,bb.max.z-bb.min.z);if(h>12&&wd<6)tall.push(x.name||x.type);});
    const guide=o.group.getObjectByName('star-guide'),ring=o.group.getObjectByName('star-guide-ring'),pts=o.group.getObjectByName('star-guide-glints');
    const pa=pts.geometry.getAttribute('position'),ba=pts.geometry.getAttribute('aBright');let rising=0,maxUp=0;const gy=g.world.heightAt(0,-20);
    for(let i=9;i<pa.count;i++){const up=pa.getY(i)-gy;if(Math.hypot(pa.getX(i),pa.getZ(i)+20)<2.2&&ba.getX(i)>.05){rising++;maxUp=Math.max(maxUp,up);}}
    const rp=ring?.geometry.getAttribute('position')??{count:0};let off=0;for(let i=0;i<rp.count;i++)off=Math.max(off,Math.abs(rp.getY(i)-.06-g.world.heightAt(rp.getX(i),rp.getZ(i))));
    return {beam:o.beam.mesh.visible,star:o.star,tall,guide:guide?.visible,ring:ring?.visible,ringOff:+off.toFixed(4),rising,maxUp:+maxUp.toFixed(2)};
  });
  console.log('goal',JSON.stringify(m.goal));

  // (4): the sanctum from straight above: the outer band's bright share (14394b7's filled plates: 2.3% of it; thin
  // glyph lines about half that).
  await view(page,[0,-75,0,1.5,26]);
  const floorPng=(await page.screenshot({path:'tmp/qa/star-r4-floor.png'})).toString('base64');
  m.floor=await page.evaluate(async png=>{
    const g=window.app.current.game,cam=g.camera;
    const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;const x=cv.getContext('2d');x.drawImage(img,0,0);
    const W=cv.width,H=cv.height,d=x.getImageData(0,0,W,H).data,V=cam.position.constructor,y0=g.world.heightAt(0,-75)+.05;
    // Pixels of the outer band (radius 14.95 to 16.25 m, the plates' course), away from the gate's side (+z).
    let n=0,bright=0;const L=[];
    for(let k=0;k<720;k++){const a=k/720*Math.PI*2;if(Math.cos(a)>.75)continue;for(let r=14.95;r<=16.25;r+=.05){const p=new V(Math.sin(a)*r,y0,-75+Math.cos(a)*r).project(cam);const px=Math.round((p.x*.5+.5)*W),py=Math.round((1-(p.y*.5+.5))*H);if(px<0||py<0||px>=W||py>=H)continue;const o=(py*W+px)*4;L.push(.2126*d[o]+.7152*d[o+1]+.0722*d[o+2]);n++;}}
    const s=[...L].sort((a,b)=>a-b),medL=s[s.length>>1];for(const v of L)if(v>medL+40)bright++;
    return {samples:n,median:+medL.toFixed(1),brightShare:+(bright/n).toFixed(4)};
  },floorPng);
  console.log('sanctum outer band',JSON.stringify(m.floor));

  // (5) fields: the meadow's large-scale values, by area of open meadow on the ground mesh.
  m.fieldValues=await page.evaluate(()=>{const gr=window.app.current.game.world2.root.getObjectByName('star-island-ground'),f=gr.geometry.getAttribute('aField');if(!f)return null;let lush=0,worn=0,plain=0;for(let i=0;i<f.count;i++){const v=f.getX(i);if(v<.3)lush++;else if(v>.7)worn++;else if(Math.abs(v-.5)<1e-6)continue;else plain++;}const open=lush+worn+plain;return {open,lush:+(lush/Math.max(open,1)).toFixed(3),worn:+(worn/Math.max(open,1)).toFixed(3)};});
  console.log('field values (open meadow vertices)',JSON.stringify(m.fieldValues));
  console.log('errors high',errors.length);for(const e of errors.slice(0,3))console.log(' ',e);
  await page.close();

  const after=await fieldL(base);m.L=after.L;
  if(after.errors.length)errors.push(...after.errors);
  let beforeL=BEFORE_L;if(before){const b=await fieldL(before);beforeL=b.L;}
  console.log('field L* before',JSON.stringify(Object.fromEntries(Object.entries(beforeL).map(([k,v])=>[k,+v.toFixed(2)]))),'after',JSON.stringify(Object.fromEntries(Object.entries(m.L).map(([k,v])=>[k,+v.toFixed(2)]))));

  // Low quality: the same world, the same sky and guide, no errors.
  const low=await open(base,'low');
  await low.page.evaluate(()=>{const g=window.app.current.game,V=g.player.unit.pos.constructor;g.objectivePos=()=>new V(0,g.world.heightAt(0,-20),-20);});
  await view(low.page,[0,40,0,.06,8]);await low.page.screenshot({path:'tmp/qa/star-r4-low.png'});
  const lowR=await low.page.evaluate(()=>{const o=window.app.current.game.objective;return {beam:o.beam.mesh.visible,ring:!!o.group.getObjectByName('star-guide-ring')?.visible};});
  console.log('low',JSON.stringify(lowR),'errors',low.errors.length);for(const e of low.errors.slice(0,3))console.log(' ',e);

  if(!metricsOnly){
    for(const [lo,hi] of m.band){assert.ok(lo[0]>lo[2]*1.05&&lo[0]>lo[1]*1.4,'warm glow 1.5 degrees up in every direction: '+lo);assert.ok(hi[2]>hi[0],'night blue 12 degrees up: '+hi);}
    assert.ok(m.corona.peaks.length>=4&&m.corona.peaks.length<=6,'four to six streamers: '+m.corona.peaks);
    assert.ok(m.corona.extent>=2&&m.corona.extent<=3.2,'streamers reach 2 to 3 disc radii: '+m.corona.extent);
    assert.ok(m.corona.fall>=2.5,'light falls steeply from the limb: '+m.corona.fall);
    assert.ok(m.goal.star&&!m.goal.beam,'no beam over the goal in World II');assert.deepEqual(m.goal.tall,[],'nothing tall, thin and glowing');
    assert.ok(m.goal.guide&&m.goal.ring&&m.goal.ringOff<.01,'ring on the ground: '+JSON.stringify(m.goal));
    assert.ok(m.goal.rising>=4&&m.goal.maxUp>=1.5,'motes rise out of the ring: '+JSON.stringify(m.goal));
    assert.ok(m.floor.brightShare<.016,'no filled plates in the outer band (14394b7: .0226): '+JSON.stringify(m.floor));
    assert.ok(m.fieldValues.lush>=.12&&m.fieldValues.worn>=.12,'three values over real areas: '+JSON.stringify(m.fieldValues));
    for(const k of Object.keys(FIELD_VIEWS))assert.ok(m.L[k]>=beforeL[k],`${k} field not darker than before: ${m.L[k].toFixed(2)} vs ${beforeL[k].toFixed(2)}`);
    assert.deepEqual(errors,[]);
    assert.ok(!lowR.beam&&lowR.ring);assert.deepEqual(low.errors,[]);
  }
  console.log(metricsOnly?'qa-star-r4 METRICS':'qa-star-r4 PASS');
}finally{await browser.close();}
