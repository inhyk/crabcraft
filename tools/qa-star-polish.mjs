// World II polish lane: lamp pools baked as light (tight, warm, on the paving, not the meadow), no swell banding on
// the sea from the overview, crystals in clusters with open meadow between (crater, mine, ring, wild), the eclipse in
// the northern sky (a disc darker than the sky inside a bright corona) seen from the street, the gate's altar in
// place of the trumeau obelisk, the moonlit glint guidance instead of gold discs, the moonstone fountain, no quest,
// resident or enemy point inside a crystal, and zero errors at high and low quality.
// Usage: CC_QA_BASE=http://127.0.0.1:5618 node tools/qa-star-polish.mjs
import {launchBrowser} from './lib/browser.mjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5192';
await mkdir('tmp/qa',{recursive:true});
const browser=await launchBrowser({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--mute-audio']});
async function open(quality){
  const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&/shader|program|WebGL|GL_|THREE/i.test(m.text()))errors.push(m.text().slice(0,300));});
  await page.addInitScript(q=>{localStorage.setItem('cc.spec',JSON.stringify({race:'human',sex:'male',classId:'warrior',shell:0,crest:0,led:0,name:'QA'}));localStorage.setItem('cc.hintsSeen','1');localStorage.setItem('cc.quality',q);},quality);
  await page.goto(base+'/?screen=game');await page.locator('.launch-notice-start').click();
  await page.waitForFunction(()=>window.app?.current?.game?.loaded&&!document.querySelector('.loading'),null,{timeout:180000});
  await page.evaluate(()=>{const g=window.app.current.game;g.god=true;g.creatorTravel=true;g.world2.go(2);});
  await page.waitForFunction(()=>window.app.current.game.world2.chapter===2&&!document.querySelector('.loading'),null,{timeout:180000});
  // A fixed camera (the same rig as the before/after captures), enemies moved off.
  await page.evaluate(()=>{const g=window.app.current.game;
    g.follow.__orig=g.follow.update;g.follow.update=function(){const s=window.__cam;if(!s)return this.__orig.apply(this,arguments);const cp=Math.cos(s.pitch);this.camera.position.set(s.tx+Math.sin(s.yaw)*cp*s.dist,s.ty+Math.sin(s.pitch)*s.dist,s.tz+Math.cos(s.yaw)*cp*s.dist);this.camera.lookAt(s.tx,s.ty,s.tz);};
    const away=()=>{for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);requestAnimationFrame(away);};away();
    const s=document.createElement('style');s.textContent='body *{visibility:hidden!important}canvas{visibility:visible!important}';document.head.appendChild(s);});
  await page.waitForTimeout(1500);
  return {page,errors};
}
const view=(page,[x,z,yaw,pitch,dist])=>page.evaluate(([x,z,yaw,pitch,dist])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,yaw+Math.PI);const u=g.player.unit.pos;window.__cam={tx:u.x,ty:u.y+1.2,tz:u.z,yaw,pitch,dist};},[x,z,yaw,pitch,dist]);
/** Luminance of screen pixels (Rec. 709 on sRGB bytes) of a page screenshot, read back in the page. */
async function pixels(page,path){
  const png=(await page.screenshot({path})).toString('base64');
  return page.evaluate(async png=>{const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);
    const d=x.getImageData(0,0,c.width,c.height).data,w=c.width,h=c.height,L=new Float32Array(w*h);for(let i=0;i<w*h;i++)L[i]=.2126*d[i*4]+.7152*d[i*4+1]+.0722*d[i*4+2];window.__px={L:Array.from(L),w,h};return [w,h];},png);
}
try{
  const {page,errors}=await open('high');
  const r=await page.evaluate(()=>{
    const g=window.app.current.game,w=g.world2,root=w.root,get=n=>root.getObjectByName(n);
    // Baked light: decode the half floats at a point.
    const tex=w.groundLight,d=tex.image.data,W=tex.image.width,H=tex.image.height;
    const half=h=>{const s=h&0x8000?-1:1,e=(h>>10)&31,f=h&1023;return e===0?s*Math.pow(2,-14)*f/1024:e===31?NaN:s*Math.pow(2,e-15)*(1+f/1024);};
    const at=(x,z)=>{const i=Math.min(W-1,Math.max(0,Math.floor((x+140)/.5))),j=Math.min(H-1,Math.max(0,Math.floor((z+160)/.5))),o=(j*W+i)*4;return [half(d[o]),half(d[o+1]),half(d[o+2])];};
    const lum=c=>.2126*c[0]+.7152*c[1]+.0722*c[2];
    // A lamp in the open street (5.75, 38): its pool's radius where it falls to a tenth, read outward over the grass.
    const c0=at(5.75,38),L0=lum(c0);let r10=0;for(let k=0;k<40;k++){const x=5.75+k*.25;if(lum(at(x,38))>=L0*.1)r10=k*.25;}
    const grass7=lum(at(12.75,38))/L0,mid=lum(at(0,38))/L0,between=lum(at(5.75,41))/L0;
    const pools=[];root.traverse(o=>{if(/lamp-pool|crystal-glow|wayfinder-glow/.test(o.name))pools.push(o.name);});
    // Crystals.
    const spots=w.crystalSpots,sites={},clusters={};for(const c of spots){sites[c.site]=(sites[c.site]??0)+1;clusters[c.cluster]=(clusters[c.cluster]??0)+1;}
    const sizes=Object.values(clusters);
    // Open meadow: of the field cells (4 m) the crystals could stand in, how many have no crystal within 8 m.
    let field=0,empty=0;
    for(let x=-110;x<=110;x+=4)for(let z=-125;z<=145;z+=4){
      if(Math.hypot(x/115,(z-10)/140)>.74)continue;
      if(Math.abs(x)<57&&z>0&&z<104||Math.abs(x)<11||Math.hypot(x,z+75)<28)continue;
      field++;if(!spots.some(c=>Math.hypot(c.x-x,c.z-z)<8))empty++;
    }
    // Nearest neighbours: crystals stand close to their own (clusters), not on an even spacing.
    const nn=spots.map(c=>Math.min(...spots.filter(o=>o!==c).map(o=>Math.hypot(o.x-c.x,o.z-c.z)))).sort((a,b)=>a-b);
    // Points that must stay clear of every crystal: quest nodes, memories, residents, enemy homes, the spawn.
    const solids=spots.map(c=>c.solid);
    const pts=[...w.nodes.map(n=>['node '+n.kind,n.position]),...w.memories.map(m=>['memory '+m.kind,m.star.position]),...g.npcs.map(n=>['npc '+n.unit.name,n.unit.pos]),...g.enemies.filter(e=>!e.isAdd).map(e=>['home '+e.kind,e.home]),['spawn',w.spawn]];
    const inside=pts.filter(([,p])=>solids.some(s=>Math.hypot(p.x-s.x,p.z-s.z)<s.r+.6)).map(([n,p])=>n+' '+p.x.toFixed(1)+','+p.z.toFixed(1));
    // The gate: the altar's stone stays low; its collider lets sight over it.
    const ob=get('star-sanctum-obelisks').geometry.attributes.position;let altarTop=-1e9;
    for(let j=0;j<ob.count;j++)if(Math.hypot(ob.getX(j),ob.getZ(j)+54)<1.8)altarTop=Math.max(altarTop,ob.getY(j)-w.height(0,-54));
    const emblems=get('star-eclipse-emblems')?.children.map(o=>o.name+':'+o.count);
    // Sky: the dome draws the eclipse; stars behind it are masked.
    const dome=w.sky.root.getObjectByName('star-aurora-dome').material.fragmentShader,stars=w.sky.root.getObjectByName('star-celestial-points').material.vertexShader;
    // Fountain and guidance.
    const life=root.getObjectByName('starhaven-life');let tori=0;life.traverse(o=>{if(o.isMesh&&o.geometry.type==='TorusGeometry'&&o.material.color&&o.material.color.getHexString()==='d9ba77')tori++;});
    const fountain=['star-fountain-stone','star-fountain-silver','star-fountain-water','star-fountain-crystal'].map(n=>!!root.getObjectByName(n));
    return {c0,r10,grass7,mid,between,pools,sites,sizes,clusterCount:sizes.length,field,empty,nnMedian:nn[nn.length>>1],nnMax:nn[nn.length-1],count:spots.length,inside,altarTop,emblems,
      eclipse:/starEclipseLight/.test(dome),masked:/eclipse/i.test(stars),tori,fountain,star:g.objective.star,stumps:get('star-island-crystal-stumps')?.count??0};
  });
  console.log('W2',JSON.stringify(r));
  assert.deepEqual(r.pools,[],'no decal pools left');
  assert.ok(r.c0[0]>r.c0[1]*1.6&&r.c0[1]>r.c0[2]*2,'pools warm: '+r.c0);
  assert.ok(r.r10>=2.5&&r.r10<=4.6,'pool radius to 10% about the lamp height: '+r.r10);
  assert.ok(r.grass7<.06,'grass 7 m out stays cool: '+r.grass7);
  assert.ok(r.mid<.2,'the two rows of pools do not merge across the street: '+r.mid);
  assert.ok(r.between<.75,'pools stay distinct along a row: '+r.between);
  assert.ok(r.sites.crater>=6&&r.sites.mine>=6&&r.sites.ring>=6&&r.sites.wild>=15,'sites: '+JSON.stringify(r.sites));
  assert.ok(r.clusterCount>=10,'clusters: '+r.clusterCount);
  assert.ok(r.sizes.every(n=>n>=3&&n<=10),'3 to 9 per cluster (the mine 10 with its stumps): '+r.sizes);
  assert.ok(r.empty/r.field>=.5,'open meadow between clusters: '+r.empty+'/'+r.field);
  assert.ok(r.nnMedian<3.5,'crystals stand with their cluster: nn median '+r.nnMedian);
  assert.ok(r.stumps>=4,'the mine has cut stumps');
  assert.deepEqual(r.inside,[],'points clear of crystals');
  assert.ok(r.altarTop<1.6,'altar stays low: '+r.altarTop);
  assert.deepEqual(r.emblems,['star-eclipse-rays:3','star-eclipse-ring:3','star-eclipse-disc:3','star-eclipse-corona:3']);
  assert.ok(r.eclipse&&r.masked,'eclipse in the dome, stars masked');
  assert.equal(r.tori,0,'no gold torus rim');assert.deepEqual(r.fountain,[true,true,true,true]);
  assert.ok(r.star,'Starhaven guidance active');

  // The eclipse from the street: disc darker than the sky round it, corona brighter than both.
  await view(page,[0,45,.3,.12,9]);await page.waitForTimeout(2200);
  await pixels(page,'tmp/qa/star-polish-street.png');
  const ecl=await page.evaluate(async()=>{
    const g=window.app.current.game,cam=g.camera,{L,w,h}=window.__px;
    const mod=await import('/src/game/starNight.ts');
    const dir=mod.STAR_ECLIPSE_DIR,R=mod.STAR_ECLIPSE_R;
    const proj=v=>{const p=cam.position.clone().addScaledVector(v,500).project(cam);return [(p.x*.5+.5)*w,(1-(p.y*.5+.5))*h];};
    const [cx,cy]=proj(dir);const up=dir.clone().applyAxisAngle(dir.clone().cross(new dir.constructor(0,1,0)).normalize(),R);
    const [ux,uy]=proj(up),rp=Math.hypot(ux-cx,uy-cy);
    const ring=(k)=>{let s=0,n=0;for(let a=0;a<64;a++){const x=Math.round(cx+Math.cos(a/64*6.283)*rp*k),y=Math.round(cy+Math.sin(a/64*6.283)*rp*k);if(x>=0&&y>=0&&x<w&&y<h){s+=L[y*w+x];n++;}}return n?s/n:-1;};
    let disc=0,n=0;for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++){const px=Math.round(cx+x*rp*.08),py=Math.round(cy+y*rp*.08);disc+=L[py*w+px];n++;}
    return {cx,cy,rp,disc:disc/n,corona:ring(1.15),sky:ring(4.5)};
  });
  console.log('eclipse',JSON.stringify(ecl));
  assert.ok(ecl.cx>0&&ecl.cx<1600&&ecl.cy>0&&ecl.cy<900,'eclipse in the street view');
  assert.ok(ecl.disc<ecl.sky,'disc darker than the sky round it');
  assert.ok(ecl.corona>ecl.disc*2&&ecl.corona>ecl.sky*1.5,'bright corona');

  // The overview: no regular swell bands on the sea in the top-left.
  await view(page,[0,0,0,1.25,180]);await page.waitForTimeout(2600);
  await pixels(page,'tmp/qa/star-polish-aerial.png');
  const band=await page.evaluate(()=>{const {L,w}=window.__px;const rows=[];for(let y=20;y<420;y++){let s=0;for(let x=20;x<300;x++)s+=L[y*w+x];rows.push(s/280);}
    // Row means less their 41-row running mean: what stripes add on top of the smooth gradient.
    let e=0;for(let i=20;i<rows.length-20;i++){let m=0;for(let k=-20;k<=20;k++)m+=rows[i+k];e+=(rows[i]-m/41)**2;}return Math.sqrt(e/(rows.length-40));});
  console.log('sea banding (luminance rms)',band.toFixed(3));
  assert.ok(band<1.2,'no swell bands on the sea (96970c1: 3.2): '+band);

  // The guidance: the glints show toward a quest point, the gold crumbs and chevron do not.
  await view(page,[0,40,0,.25,9]);await page.waitForTimeout(1500);
  const guide=await page.evaluate(()=>{const o=window.app.current.game.objective.group;const s=o.getObjectByName('star-guide-glints');let gold=0;o.traverse(c=>{if(c.isInstancedMesh&&c.visible)gold++;});return {glints:!!s,visible:s?.parent?.visible??false,gold};});
  console.log('guide',JSON.stringify(guide));
  assert.ok(guide.glints);assert.equal(guide.gold,0,'no gold crumb discs in World II');
  await page.screenshot({path:'tmp/qa/star-polish-guide.png'});
  assert.deepEqual(errors,[]);await page.close();

  // Low quality builds and renders the same world without errors.
  const low=await open('low');
  await view(low.page,[0,45,.3,.12,9]);await low.page.waitForTimeout(2000);
  await low.page.screenshot({path:'tmp/qa/star-polish-low.png'});
  const lowR=await low.page.evaluate(()=>{const w=window.app.current.game.world2;return {spots:w.crystalSpots.length,light:!!w.groundLight};});
  console.log('low',JSON.stringify(lowR),'errors',low.errors.length);
  assert.ok(lowR.spots>40&&lowR.light);assert.deepEqual(low.errors,[]);
  console.log('PASS: tight warm lamp light, clean sea from above, clustered crystals with reasons, eclipse in the street sky, gate altar, moonlit guidance, moonstone fountain, zero errors high and low');
}finally{await browser.close();}
