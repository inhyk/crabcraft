// World II light lane: the night rig (moon, shade, fog, environment, view), the sky, crystal clusters, the sanctum,
// the Starhaven gateway, lanterns and roofs. Present, counted, no primitives left in scope, colliders hold the art,
// the shore gets its own environment and view back, zero errors at high and low quality.
// Usage: CC_QA_BASE=http://127.0.0.1:5615 node tools/qa-star-light.mjs
import {launchBrowser} from './lib/browser.mjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5192';
await mkdir('tmp/qa',{recursive:true});
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
async function open(quality){
  const page=await browser.newPage({viewport:{width:1280,height:760}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL|GL_|THREE/i.test(m.text()))errors.push(m.text().slice(0,300));});
  await page.addInitScript(q=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'QA'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.quality',q);},quality);
  await page.goto(base+'/?screen=game');await page.locator('.launch-notice-start').click();
  await page.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:180000});
  return {page,errors};
}
try{
  const {page,errors}=await open('high');
  const shore=await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.creatorTravel=true;return {env:g.scene.environment?.uuid??null,view:!!g.engine.viewOptions.grade};});
  await page.evaluate(()=>window.app.current.game.world2.go(2));
  await page.waitForFunction(()=>window.app.current.game.world2.chapter===2&&!document.querySelector('.loading'),null,{timeout:120000});
  await page.waitForTimeout(1500);
  const r=await page.evaluate(()=>{
    const g=window.app.current.game,w=g.world2,root=w.root,get=n=>root.getObjectByName(n);
    const types=new Set();const primitives=[];
    for(const name of ['star-sanctum','star-island-crystal-gardens','moonshade-crystal-leaves','star-road-wayfinders'])get(name).traverse(o=>{if(o.isMesh&&/^(Box|Octahedron|Cylinder|Icosahedron)Geometry$/.test(o.geometry.type))primitives.push(name+':'+o.geometry.type);});
    const gates=[];root.traverse(o=>{if(o.name==='star-gate-stone')gates.push(o.parent.name);});
    // The W2 gates replace StarPortal's box ring; the shore keeps its StarPortal.
    root.traverse(o=>{if(o.isMesh&&o.geometry.type==='BoxGeometry'&&o.parent&&/별빛 항구 →/.test(o.parent.name))primitives.push('box ring in '+o.parent.name);});
    const settlement=get('starhaven-settlement');
    const instanced=settlement.children.filter(o=>o.isInstancedMesh).map(o=>o.name+':'+o.count);
    const poles=settlement.children.filter(o=>o.isMesh&&o.geometry.type==='CylinderGeometry').length;
    let roof=null;settlement.traverse(o=>{if(o.isMesh&&o.material.name==='MI_RoundTiles')roof=o.material.customProgramCacheKey();});
    const crowns=['teal','violet'].map(t=>get('star-sanctum-crowns-'+t).count);
    const clusterNames=['star-island-crystal-gardens','moonshade-crystal-leaves','star-road-wayfinders'].map(n=>get(n).geometry.name);
    const rig=get('star-night-rig'),sun=root.getObjectByName('star-island-sun');
    const moonDir=sun.position.clone().sub(sun.target.position).normalize();
    const moon=w.sky.root.getObjectByName('star-crescent-moon').position.clone().normalize();
    const los=w.collision.shapes.filter(s=>s.kind===1&&s.b.los).length;
    // Every garden facet inside the collider measured from the old crystal (unchanged on the server).
    const mesh=get('star-island-crystal-gardens'),p=mesh.geometry.attributes.position,m=mesh.matrix.clone(),v=g.player.unit.pos.clone();let solid=0,maxExcess=0;
    for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,m);if(m.elements[0]===0&&m.elements[5]===0)continue;const o=w.crystalSolids[solid++];for(let j=0;j<p.count;j++){v.fromBufferAttribute(p,j).applyMatrix4(m);maxExcess=Math.max(maxExcess,Math.hypot(v.x-o.x,v.z-o.z)-o.r);}}
    // Gate piers inside the sanctuary's colliders (r 1).
    const piers=get('sanctuary-gate-piers').geometry.attributes.position;let pierExcess=0;
    for(let j=0;j<piers.count;j++){const x=piers.getX(j),z=piers.getZ(j),y=piers.getY(j);const c=[[-4.8,-55],[4.8,-55],[-8,-47],[8,-47]].reduce((b,c)=>Math.hypot(x-c[0],z-c[1])<Math.hypot(x-b[0],z-b[1])?c:b);pierExcess=Math.max(pierExcess,Math.hypot(x-c[0],z-c[1])-1,y-(w.height(c[0],c[1])+6.4));}
    // Obelisks inside the twelve r 1.7 footprints.
    const ob=get('star-sanctum-obelisks').geometry.attributes.position;let obExcess=0;
    for(let j=0;j<ob.count;j++){const x=ob.getX(j),z=ob.getZ(j);let best=1e9;for(let i=0;i<12;i++){const a=i/12*Math.PI*2;best=Math.min(best,Math.hypot(x-Math.sin(a)*21,z-(-75+Math.cos(a)*21)));}obExcess=Math.max(obExcess,best-1.7);}
    return {primitives,gates,instanced,poles,roof,crowns,clusterNames,rig:!!rig,moonDot:moonDir.dot(moon),fog:g.scene.fog.density,envNight:g.scene.environment?.uuid,view:g.engine.viewOptions.grade?.split?true:false,los,solid,maxExcess,pierExcess,obExcess,
      stars:w.sky.root.getObjectByName('star-celestial-points').geometry.attributes.position.count};
  });
  console.log('W2',JSON.stringify(r));
  assert.deepEqual(r.primitives,[]);
  assert.equal(r.gates.length,2);
  // 13 iron posts of the 26 lamp places since star r3: the rest are crook posts, crystal lamps and gaps (starLight.ts STAR_LAMP_KIND).
  assert.deepEqual(r.instanced,['starhaven-lantern-posts:13','starhaven-lantern-panes:13']);
  assert.equal(r.poles,0);
  assert.equal(r.roof,'starhaven-roof');
  assert.deepEqual(r.crowns,[7,6]);
  assert.deepEqual(r.clusterNames,['star-crystal-cluster','star-crystal-cluster','star-crystal-cluster']);
  // Star r3 made the corona the key; star r4 gave the key back to the drawn moon (starNight.ts STAR_KEY_DIR).
  assert.ok(r.rig);assert.ok(r.moonDot>.999,'moonlight comes from the drawn moon');
  assert.ok(r.view,'Starhaven view active');assert.ok(r.envNight&&r.envNight!==shore.env,'night environment');
  assert.ok(r.los>=5);assert.ok(r.solid>0);assert.ok(r.maxExcess<.001);assert.ok(r.pierExcess<.001);assert.ok(r.obExcess<.001);
  assert.equal(r.stars,2400);
  // Close-ups from the game camera.
  for(const [name,x,z,yaw,pitch,dist] of [['sanctum',0,-70,.26,.35,13],['gate',0,-33,0,.15,12],['portal',0,79,3.14,.15,11],['lanterns',5,42,-.7,.12,7],['crystals',-62,8,1.1,.22,14]]){
    await page.evaluate(([x,z,yaw,pitch,dist])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,yaw+Math.PI);g.follow.cut();g.follow.yaw=yaw;g.follow.pitch=pitch;g.follow.distance=dist;},[x,z,yaw,pitch,dist]);
    await page.waitForTimeout(1600);await page.screenshot({path:`tmp/qa/star-light-${name}.png`});
  }
  // Back to the shore: its environment and view come back; World I keeps its StarPortal.
  await page.evaluate(()=>window.app.current.game.world2.go(1));await page.waitForTimeout(1500);
  const back=await page.evaluate(()=>{const g=window.app.current.game;const portal=g.world2.shorePortal.root;let boxes=0;portal.traverse(o=>{if(o.isMesh&&o.geometry.type==='BoxGeometry')boxes++;});return {env:g.scene.environment?.uuid??null,view:!!g.engine.viewOptions.grade,boxes};});
  console.log('shore',JSON.stringify(back),'was',JSON.stringify(shore));
  assert.equal(back.view,shore.view);assert.notEqual(back.env,r.envNight);assert.equal(back.boxes,13);
  assert.deepEqual(errors,[]);await page.close();
  // Low quality builds and renders the same world without errors.
  const low=await open('low');
  await low.page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.creatorTravel=true;g.world2.go(2);});
  await low.page.waitForFunction(()=>window.app.current.game.world2.chapter===2&&!document.querySelector('.loading'),null,{timeout:120000});
  await low.page.evaluate(()=>{const g=window.app.current.game;g.player.unit.teleport(g.world,0,-62,Math.PI);g.follow.cut();});
  await low.page.waitForTimeout(2500);await low.page.screenshot({path:'tmp/qa/star-light-low.png'});
  assert.deepEqual(low.errors,[]);
  console.log('PASS: Starhaven night rig, sky, crystal clusters, sanctum, gateways, lanterns and roofs; colliders hold the art; shore restored; high and low quality without errors');
}finally{await browser.close();}
