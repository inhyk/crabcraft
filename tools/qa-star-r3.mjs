// World II third round: the night key is the moon at about half its old strength with soft, partial shadows from
// where the moon hangs; the crab reads against the dark meadow in the east field (it carries a warm light); the
// sanctum floor has three value levels (dark slate, mid stone bands, bright inlay); the trees are teal, not grass
// green; Starhaven's roofline props (finials, observatory dome, telescopes, ridge and door lanterns, banners, smoke),
// the newcomers' dark-windowed house, trail lanterns, loose stones; the sea shows the eclipse as a glitter path, not a
// ring; the aerial coast has no bright teal rim; zero errors at high and low quality.
// Usage: CC_QA_BASE=http://127.0.0.1:5622 node tools/qa-star-r3.mjs   (QA_METRICS_ONLY=1 prints the pixel metrics
// without asserting, for a before build).
import {launchBrowser} from './lib/browser.mjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base=process.env.CC_QA_BASE??'http://127.0.0.1:5192',metricsOnly=!!process.env.QA_METRICS_ONLY;
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
  await page.evaluate(()=>{const g=window.app.current.game;
    g.follow.__orig=g.follow.update;g.follow.update=function(){const s=window.__cam;if(!s)return this.__orig.apply(this,arguments);const cp=Math.cos(s.pitch);this.camera.position.set(s.tx+Math.sin(s.yaw)*cp*s.dist,s.ty+Math.sin(s.pitch)*s.dist,s.tz+Math.cos(s.yaw)*cp*s.dist);this.camera.lookAt(s.tx,s.ty,s.tz);};
    const away=()=>{for(const e of g.enemies)e.unit.teleport?.(g.world,200,200);requestAnimationFrame(away);};away();
    const s=document.createElement('style');s.textContent='body *{visibility:hidden!important}canvas{visibility:visible!important}';document.head.appendChild(s);});
  await page.waitForTimeout(1500);
  return {page,errors};
}
const view=(page,[x,z,yaw,pitch,dist])=>page.evaluate(([x,z,yaw,pitch,dist])=>{const g=window.app.current.game;g.player.unit.teleport(g.world,x,z,yaw+Math.PI);const u=g.player.unit.pos;window.__cam={tx:u.x,ty:u.y+1.2,tz:u.z,yaw,pitch,dist};},[x,z,yaw,pitch,dist]);
/** RGB bytes of a page screenshot, kept in the page for sampling. */
async function pixels(page,path){
  const png=(await page.screenshot({path})).toString('base64');
  return page.evaluate(async png=>{const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);
    const d=x.getImageData(0,0,c.width,c.height).data;window.__px={d:Array.from(d),w:c.width,h:c.height};return [c.width,c.height];},png);
}
const metrics={};
try{
  const {page,errors}=await open('high');
  // Scene: lights, roofline, sanctum, sea.
  const r=await page.evaluate(()=>{
    const g=window.app.current.game,w=g.world2,root=w.root,get=n=>root.getObjectByName(n);
    const sun=get('star-island-sun'),moonDir=sun.position.clone().sub(sun.target.position).normalize(),moon=w.sky.root.getObjectByName('star-crescent-moon').position.clone().normalize();
    const glow=get('star-player-glow');
    const roof=get('star-rooftops');const names={};roof?.traverse(o=>{if(o.isInstancedMesh)names[o.name]=o.count;else if(o.isMesh)names[o.name]=(names[o.name]??0)+1;});
    const settlement=get('starhaven-settlement');let darkGlass=0,leaves=[];settlement.traverse(o=>{if(o.isMesh&&o.material?.name==='MI_WindowGlass_Dark')darkGlass++;if(o.material?.name?.startsWith?.('Leaves'))leaves.push(o.material.customProgramCacheKey?.());});
    const floor=get('star-sanctum').children.find(o=>o.material?.name==='star-sanctum-floor');
    const rubble=get('star-sanctum-rubble'),stones=get('starhaven-loose-stones');
    const sea=w.sea.root.material.fragmentShader;
    return {intensity:sun.intensity,radius:sun.shadow.radius,shadow:sun.shadow.intensity,moonDot:moonDir.dot(moon),glow:glow?{d:glow.distance,i:glow.intensity,off:glow.position.distanceTo(g.player.unit.pos)}:null,
      names,dome:!!get('star-observatory-dome'),darkGlass,leaves:[...new Set(leaves)],floor:floor?.material.color.getHexString(),rubble:rubble?.geometry.attributes.position.count??0,stones:stones?.geometry.attributes.position.count??0,
      seaRing:/starAtmosphere\(reflected/.test(sea),seaPath:/eclPath/.test(sea)};
  });
  console.log('W2',JSON.stringify(r));
  if(!metricsOnly){
    assert.ok(r.intensity<=2.2&&r.intensity>=1.4,'moon key about half of the old 3.3: '+r.intensity);
    assert.ok(r.radius>=4,'soft moon shadows: radius '+r.radius);assert.ok(r.shadow<=.7,'partial moon shadows: '+r.shadow);
    assert.ok(r.moonDot>.99,'shadows fall from the visible moon: '+r.moonDot);
    assert.ok(r.glow&&r.glow.d<=7&&r.glow.off<3,'warm light carried with the crab: '+JSON.stringify(r.glow));
    assert.ok(r.names['star-roof-finials']>=18,'crescent finials on every ridge');assert.ok(r.dome,'observatory dome');
    assert.equal(r.names['star-roof-telescopes'],2);assert.ok(r.names['star-door-lantern-frames']>=10,'door lanterns');assert.equal(r.names['star-ridge-lantern-frames'],4);
    assert.ok(r.names['star-map-banners']>=9,'star-map banners');assert.ok(r.names['star-chimney-smoke']>=40,'chimney smoke');assert.ok(r.names['star-trail-lantern-posts']>=8,'trail lanterns');
    assert.ok(r.darkGlass>=1,'the newcomers\' house has dark windows');
    assert.ok(r.leaves.length&&r.leaves.every(k=>k==='star-wind-v1-leaves'),'teal canopies: '+r.leaves);
    assert.equal(r.floor,'2a3346','dark slate sanctum floor');assert.ok(r.rubble>0&&r.stones>0,'rubble and loose stones');
    assert.ok(!r.seaRing&&r.seaPath,'sea: glitter path, no reflected ring');
  }

  // East field, game camera: the crab against the meadow round it (mean RGB distance, crab box vs an annulus).
  await view(page,[60,-5,-1.2,.35,9]);await page.waitForTimeout(2600);
  await pixels(page,'tmp/qa/star-r3-east.png');
  metrics.crab=await page.evaluate(()=>{
    const g=window.app.current.game,cam=g.camera,{d,w,h}=window.__px,u=g.player.unit.pos;
    const p=u.clone();p.y+=.5;p.project(cam);const cx=(p.x*.5+.5)*w,cy=(1-(p.y*.5+.5))*h;
    const mean=(f)=>{let s=[0,0,0],n=0;for(let y=Math.max(0,Math.floor(cy-160));y<Math.min(h,cy+160);y+=2)for(let x=Math.max(0,Math.floor(cx-220));x<Math.min(w,cx+220);x+=2){if(!f(x-cx,y-cy))continue;const o=(y*w+x)*4;s[0]+=d[o];s[1]+=d[o+1];s[2]+=d[o+2];n++;}return s.map(v=>v/Math.max(n,1));};
    const crab=mean((dx,dy)=>Math.abs(dx)<34&&Math.abs(dy)<26),ring=mean((dx,dy)=>{const r=Math.hypot(dx/1.4,dy);return r>70&&r<150;});
    return {crab,ring,dist:Math.hypot(crab[0]-ring[0],crab[1]-ring[1],crab[2]-ring[2]),warm:(crab[0]-crab[2])-(ring[0]-ring[2])};
  });
  console.log('crab vs meadow',JSON.stringify(metrics.crab));

  // Sanctum from above: slate field, stone band and silver inlay as three distinct values.
  await view(page,[0,-75,0,1.35,30]);await page.waitForTimeout(2600);
  await pixels(page,'tmp/qa/star-r3-arena.png');
  metrics.floor=await page.evaluate(()=>{
    const g=window.app.current.game,cam=g.camera,{d,w,h}=window.__px,V=cam.position.constructor;
    const L=(x,y)=>{x=Math.round(x);y=Math.round(y);const o=(y*w+x)*4;return .2126*d[o]+.7152*d[o+1]+.0722*d[o+2];};
    const scr=(r,a)=>{const p=new V(Math.sin(a)*r,3.08,-75+Math.cos(a)*r).project(cam);return [(p.x*.5+.5)*w,(1-(p.y*.5+.5))*h];};
    const med=a=>{a.sort((x,y)=>x-y);return a[a.length>>1];};
    const at=(r)=>{const v=[];for(let k=0;k<48;k++){const a=(k+.5)/48*Math.PI*2;if(Math.abs(Math.sin(a))<.3&&Math.cos(a)>0)continue;const [x,y]=scr(r,a);if(x>2&&y>2&&x<w-2&&y<h-2)v.push(L(x,y));}return med(v);};
    // Inlay: the brightest pixel near the 8.5 m ring line, per angle.
    const inl=[];for(let k=0;k<48;k++){const a=(k+.5)/48*Math.PI*2;if(Math.abs(Math.sin(a))<.3&&Math.cos(a)>0)continue;let best=0;for(let dr=-.25;dr<=.25;dr+=.02){const [x,y]=scr(8.5+dr,a);if(x>2&&y>2&&x<w-2&&y<h-2)best=Math.max(best,L(x,y));}inl.push(best);}
    return {slate:at(7),band:at(16.6),inlay:med(inl)};
  });
  console.log('floor values',JSON.stringify(metrics.floor));

  // Overview: the coast's rim (the brightest teal excess just off the island's west edge) is not a glowing ring.
  await view(page,[0,0,0,1.25,180]);await page.waitForTimeout(2600);
  await pixels(page,'tmp/qa/star-r3-aerial.png');
  metrics.rim=await page.evaluate(()=>{
    const g=window.app.current.game,cam=g.camera,{d,w,h}=window.__px,V=cam.position.constructor;
    // Walk out from the island's centre westward and northward at several bearings: the peak teal excess.
    let peak=0;for(const [ax,az] of [[-1,0],[-1,.3],[-1,-.3],[-.7,.7],[-.7,-.7]]){for(let t=60;t<150;t+=.5){const p=new V(ax*t,0,10+az*t).project(cam);const x=Math.round((p.x*.5+.5)*w),y=Math.round((1-(p.y*.5+.5))*h);if(x<0||y<0||x>=w||y>=h)continue;const o=(y*w+x)*4;peak=Math.max(peak,(d[o+1]+d[o+2])/2-d[o]);}}
    return {peak};
  });
  console.log('coast rim',JSON.stringify(metrics.rim));
  if(!metricsOnly){
    assert.ok(metrics.crab.dist>=55,'the crab stands out from the meadow: '+metrics.crab.dist.toFixed(1));
    assert.ok(metrics.floor.slate<metrics.floor.band*.85&&metrics.floor.band<metrics.floor.inlay*.8,'three floor values: '+JSON.stringify(metrics.floor));
    assert.ok(metrics.rim.peak<60,'no glowing teal rim: '+metrics.rim.peak);
  }
  console.log('errors high',errors.length);for(const e of errors.slice(0,3))console.log(' ',e);
  if(!metricsOnly)assert.deepEqual(errors,[]);await page.close();

  // Low quality builds and renders the same world without errors.
  const low=await open('low');
  await view(low.page,[0,62,.4,.3,22]);await low.page.waitForTimeout(2000);
  await low.page.screenshot({path:'tmp/qa/star-r3-low.png'});
  const lowR=await low.page.evaluate(()=>{const w=window.app.current.game.world2;return {roof:!!w.root.getObjectByName('star-rooftops'),floor:!!w.root.getObjectByName('star-sanctum-rubble')};});
  console.log('low',JSON.stringify(lowR),'errors',low.errors.length);
  if(!metricsOnly){assert.ok(lowR.roof&&lowR.floor);assert.deepEqual(low.errors,[]);}
  console.log(metricsOnly?'qa-star-r3 METRICS':'qa-star-r3 PASS');
}finally{await browser.close();}
