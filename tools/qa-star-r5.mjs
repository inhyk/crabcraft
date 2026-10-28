// World II fifth round: the wilds by moonlight. (1) The wild views (tmp/cap.mjs east, west, aerial: 1600x900, crab in
// frame, no HUD) are lighter than c82accf's (mean CIELAB L*), and east and aerial spread wider (p10 to p99 of L*); the
// west view loses the dark tree that hid the crab, so its spread may fall a little but not by more than 2.5; the crab
// stands out more than it did in both (its box against a ring round it, mean L*). (2) Lit points in
// the wilds: glowing moon-flower clumps and their light on the ground, fireflies. (3) Three tree species (silver,
// crystal, snag) beside the night teal, every kit trunk and crown in World II's night shading, the hero crystal tree's
// crystals at its roots. (4) Dead-end ways fray: inside the old box but off the laid stones at the tip, an earth path
// on to a door with no grass on it. (5) Houses: pale plinth course on masonry and plaster, window light on the ground.
// (6) The eclipse story: props, charts, glow, the drums and table solid. No dodecahedron rubble at the observatory.
// Zero page and shader errors at high and low quality; low keeps the fireflies cheaper.
// Usage: CC_QA_BASE=http://127.0.0.1:5628 node tools/qa-star-r5.mjs
//   CC_QA_BEFORE=http://127.0.0.1:5624 also measures the before build (else the recorded c82accf numbers).
//   QA_METRICS_ONLY=1 prints the numbers without asserting.
import {launchBrowser} from './lib/browser.mjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5628',before=process.env.CC_QA_BEFORE,metricsOnly=!!process.env.QA_METRICS_ONLY;
/** c82accf in the same views (measured 2026-10-28 with this script's camera). */
const BEFORE={east:{L:17.93,spread:43.24,crab:17.11},west:{L:24.42,spread:58.72,crab:4.47},aerial:{L:16.97,spread:33.98}};
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
/** The frame's L* statistics (sRGB, D65), and the crab's: mean L* of its box's inner half against a ring one box wide round it. */
async function frameStats(page,path){
  const box=await page.evaluate(()=>{const g=window.app.current.game,r=g.player.unit.rig.root,V=r.position.constructor,cam=g.camera;r.updateMatrixWorld(true);let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;const v=new V();r.traverse(o=>{if(!o.isMesh||!o.visible)return;const pa=o.geometry.getAttribute('position');if(!pa)return;const st=Math.max(1,Math.floor(pa.count/200));for(let i=0;i<pa.count;i+=st){v.fromBufferAttribute(pa,i);if(o.isSkinnedMesh)o.applyBoneTransform(i,v);v.applyMatrix4(o.matrixWorld).project(cam);const px=(v.x*.5+.5)*1600,py=(1-(v.y*.5+.5))*900;x0=Math.min(x0,px);x1=Math.max(x1,px);y0=Math.min(y0,py);y1=Math.max(y1,py);}});return [x0,y0,x1,y1].map(Math.round);});
  const png=(await page.screenshot({path})).toString('base64');
  return page.evaluate(async([png,box])=>{const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);
    const W=c.width,H=c.height,d=x.getImageData(0,0,W,H).data,lin=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;},T=new Float64Array(256).map((_,i)=>lin(i));
    const L=new Float32Array(W*H);let s=0;for(let i=0,p=0;i<d.length;i+=4,p++){const Y=.2126*T[d[i]]+.7152*T[d[i+1]]+.0722*T[d[i+2]];L[p]=Y>.008856?116*Math.cbrt(Y)-16:903.3*Y;s+=L[p];}
    const sorted=Float32Array.from(L).sort(),pc=q=>sorted[Math.floor(q*(sorted.length-1))];
    const [x0,y0,x1,y1]=box,w=x1-x0,h=y1-y0;let ci=0,cn=0,ri=0,rn=0;
    for(let y=Math.max(0,y0-h);y<Math.min(H,y1+h);y++)for(let xx=Math.max(0,x0-w);xx<Math.min(W,x1+w);xx++){const v=L[y*W+xx];const inBox=xx>=x0&&xx<x1&&y>=y0&&y<y1;if(inBox){if(xx>=x0+w/4&&xx<x1-w/4&&y>=y0+h/4&&y<y1-h/4){ci+=v;cn++;}}else{ri+=v;rn++;}}
    return {L:s/L.length,spread:pc(.99)-pc(.1),p10:pc(.1),p99:pc(.99),crab:Math.abs(ci/Math.max(cn,1)-ri/Math.max(rn,1))};},[png,box]);
}
const WILD_VIEWS={east:[60,-5,-1.57,.3,26],west:[-60,-5,1.57,.3,26],aerial:[0,0,0,1.25,180]};
async function wildStats(url,tag){const {page,errors}=await open(url,'high');const out={};for(const [k,v] of Object.entries(WILD_VIEWS)){await view(page,v);out[k]=await frameStats(page,`tmp/qa/star-r5-${k}-${tag}.png`);}await page.close();return {stats:out,errors};}
const r2=v=>+v.toFixed(2);

const m={};
try{
  const {page,errors}=await open(base,'high');
  m.scene=await page.evaluate(async()=>{
    const g=window.app.current.game,w=g.world2,root=w.root,by=n=>root.getObjectByName(n);
    const ff=by('starhaven-fireflies'),trees=by('starhaven-tree-species'),fields=by('starhaven-fields'),forests=by('star-island-forests');
    const night=[];forests.traverse(o=>{if(o.isBatchedMesh&&/^(Bark|Leaves)_NormalTree$/.test(o.material.name))night.push([o.material.name,o.material.userData.starVariant??'teal',o.material.customProgramCacheKey()]);});
    const rubble=by('observatory-rubble');
    const paving=by('world2-moonlit-paving'),paved=paving.userData.paved,covers=paving.userData.covers;
    const wilds=await import('/src/game/starWilds.ts'),light=await import('/src/game/starLight.ts'),roof=await import('/src/game/starRooftops.ts'),set=await import('/src/game/world2Settlement.ts');
    const spur=wilds.starWaySpurs()[0],mid=spur.pts[8];
    const meadow=by('starhaven-meadow'),mk=meadow.userData.mask,cell=(x,z)=>mk.data[(Math.floor((z-mk.minZ)/mk.cell)*mk.width+Math.floor((x-mk.minX)/mk.cell))*4]/255;
    const spill=roof.starWindowSpillGlows(set.starLots(),roof.STAR_ROOF_ROLES.empty)[0],spillLight=light.sampleStarLight(spill.x,spill.z);
    const clump=wilds.starWildClumps()[0],clumpLight=light.sampleStarLight(clump.x,clump.z);
    let plaster=null;root.traverse(o=>{const ms=o.material?(Array.isArray(o.material)?o.material:[o.material]):[];for(const mt of ms)if(mt.name==='MI_Plaster')plaster=mt.customProgramCacheKey?.();});
    // Solids: the drums and the table push a crab out of them.
    const solids=(await import('/src/game/starFieldLayout.ts')).starEclipseSolids(),out={x:0,y:0,set(a,b){this.x=a;this.y=b;return this;}};
    const pushed=solids.map(s=>{const o=g.world.resolveCollision(s.x+.05,s.z,.5,out)??out;return Math.hypot(o.x-s.x,o.y-s.z);});
    return {fireflies:ff?.geometry.getAttribute('position').count??0,trees:trees?.userData,wildFlowers:fields?.userData.wildFlowers??0,night,
      eclipse:['starhaven-eclipse-props','starhaven-eclipse-charts','starhaven-eclipse-glow'].map(n=>!!by(n)),
      rubble:rubble?.geometry.type,frayTip:{paved:paved(25.5,57.8),covers:covers(25.5,57.8)},frayMid:paved(20,55),
      spur:{wear:wilds.starSpurWear(mid[0],mid[1]),grass:cell(mid[0],mid[1])},clumps:wilds.starWildClumps().length,clumpLight:clumpLight.reduce((a,b)=>a+b,0),
      spill:spillLight.reduce((a,b)=>a+b,0),plaster,pushed};
  });
  console.log('scene',JSON.stringify(m.scene));
  console.log('errors high',errors.length);for(const e of errors.slice(0,3))console.log(' ',e);
  await page.close();

  const after=await wildStats(base,'after');m.after=after.stats;errors.push(...after.errors);
  let beforeS=BEFORE;if(before){const b=await wildStats(before,'before');beforeS=b.stats;}
  for(const k of Object.keys(WILD_VIEWS))console.log(k,'before',JSON.stringify(Object.fromEntries(Object.entries(beforeS[k]).map(([a,b])=>[a,r2(b)]))),'after',JSON.stringify(Object.fromEntries(Object.entries(m.after[k]).map(([a,b])=>[a,r2(b)]))));

  // Low quality: the same world, fewer fireflies drawn, no errors.
  const low=await open(base,'low');
  await view(low.page,[60,-5,-1.57,.3,26]);await low.page.screenshot({path:'tmp/qa/star-r5-low-east.png'});
  const lowR=await low.page.evaluate(()=>{const p=window.app.current.game.world2.root.getObjectByName('starhaven-fireflies');return {drawn:p.geometry.drawRange.count,all:p.geometry.getAttribute('position').count};});
  console.log('low',JSON.stringify(lowR),'errors',low.errors.length);for(const e of low.errors.slice(0,3))console.log(' ',e);

  if(!metricsOnly){
    const s=m.scene;
    assert.ok(s.fireflies>=300,'fireflies: '+s.fireflies);
    assert.ok(s.clumps>=30&&s.wildFlowers>=s.clumps*12,'moon-flower clumps through the wilds: '+s.clumps+' clumps, '+s.wildFlowers+' flowers');
    assert.ok(s.clumpLight>.3,'a clump lights its ground: '+s.clumpLight);
    assert.ok(s.trees.snags>=10&&s.trees.crystalTrees>=10&&s.trees.silverTrees>=15&&s.trees.rootCrystals>=s.trees.crystalTrees*3,'three species: '+JSON.stringify(s.trees));
    assert.ok(s.night.length>=6&&s.night.every(([,,key])=>/night/.test(key)),'every kit trunk and crown in the night shading: '+JSON.stringify(s.night));
    for(const v of ['silver','crystal','teal'])assert.ok(s.night.some(([,variant])=>variant===v),'species material '+v);
    assert.ok(s.eclipse.every(Boolean),'eclipse story meshes: '+s.eclipse);
    assert.ok(s.pushed.every(d=>d>.5&&d<2),'drums and table are solid: '+s.pushed);
    assert.notEqual(s.rubble,'DodecahedronGeometry','observatory rubble is sculpted stone');
    assert.ok(s.frayTip.covers&&!s.frayTip.paved&&s.frayMid,'a dead end frays inside its old box: '+JSON.stringify(s));
    assert.ok(s.spur.wear>.8&&s.spur.grass<.1,'an earth path runs on from the dead end, no grass on it: '+JSON.stringify(s.spur));
    assert.equal(s.plaster,'starhaven-lamplit-plinth','plaster walls stand on the plinth course');
    assert.ok(s.spill>.2,'window light on the ground: '+s.spill);
    const A=m.after,B=beforeS;
    for(const k of ['east','west','aerial'])assert.ok(A[k].L>B[k].L+.8,`${k}: lighter than before (${r2(A[k].L)} vs ${r2(B[k].L)})`);
    for(const k of ['east','aerial'])assert.ok(A[k].spread>B[k].spread,`${k}: wider value range (${r2(A[k].spread)} vs ${r2(B[k].spread)})`);
    assert.ok(A.west.spread>B.west.spread-2.5,`west: value range within 2.5 of before (${r2(A.west.spread)} vs ${r2(B.west.spread)})`);
    assert.ok(A.west.crab>B.west.crab+5,`west: the crab stands out (${r2(A.west.crab)} vs ${r2(B.west.crab)})`);
    assert.ok(A.east.crab>B.east.crab,`east: the crab stands out more (${r2(A.east.crab)} vs ${r2(B.east.crab)})`);
    assert.deepEqual(errors,[]);
    assert.ok(lowR.drawn<lowR.all,'low draws fewer fireflies');assert.deepEqual(low.errors,[]);
  }
  console.log(metricsOnly?'qa-star-r5 METRICS':'qa-star-r5 PASS');
}finally{await browser.close();}
