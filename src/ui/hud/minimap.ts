// Round minimap (top right). The zone picture is a top-down render of the world made at load;
// the map turns with the camera so "up" is always where you are looking.
import {VOYAGE_ISLANDS} from '../../world/voyage';
import { h } from '../dom';
import {t} from '../../i18n';
import type { Game } from '../../game/game';
import type { MapSnapshot } from '../../game/snapshots';
import type { PoiId } from '../../world/types';

// Match the existing party roster colors. Shapes distinguish players from townsfolk.
const PARTY_COLORS:Record<number,string>={0:'#d4dbe5',1:'#8cbdff',2:'#ff9d9d',3:'#ffe6a0',4:'#d5abff'};

const shorePoiIcons = (): Partial<Record<PoiId, { label: string; color: string }>> => ({
  forge: { label: t('대장간','Forge'), color: '#ff9a4a' },
  chapel: { label: t('성소','Chapel'), color: '#ffe9a0' },
  tavern: { label: t('주점','Tavern'), color: '#ffb36b' },
  grove: { label: t('숲','Grove'), color: '#b7a0ff' },
  lighthouse: { label: t('등대','Lighthouse'), color: '#fff3c0' },
  wreck: { label: t('난파선','Wreck'), color: '#ff6a4a' },
});

export class Minimap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private zoneEl: HTMLElement;
  private northEl: HTMLElement;
  private snap: MapSnapshot | null = null;
  expanded = false;
  private expandedRadius = 200;
  private compactRadius = 52;
  private expandButton: HTMLButtonElement;
  private mapHelp: HTMLElement;
  private mapControls: HTMLElement;
  private acc = 0;
  /** World units from centre to rim. */
  radius = 52;
  private size = 196;
  private dpr = Math.min(2, window.devicePixelRatio || 1);

  constructor(private readonly game: Game) {
    this.canvas = h('canvas');
    this.canvas.width = this.canvas.height = Math.round(this.size * this.dpr);
    this.ctx = this.canvas.getContext('2d')!;
    this.zoneEl = h('div', { class: 'mm-zone' }, 'Clawhaven');
    this.northEl = h('div', { class: 'mm-n' }, 'N');
    const ring = h('div', { class: 'mm-ring hud-i' }, this.canvas, this.northEl);
    this.expandButton=h('button',{class:'mm-expand hud-i',type:'button'},'');
    this.expandButton.addEventListener('click',()=>this.toggle());
    const zoomIn=h('button',{type:'button','aria-label':t('지도 확대','Zoom in')},'+');
    const zoomOut=h('button',{type:'button','aria-label':t('지도 축소','Zoom out')},'−');
    zoomIn.addEventListener('click',()=>this.zoom(1/1.25));zoomOut.addEventListener('click',()=>this.zoom(1.25));
    this.mapControls=h('div',{class:'mm-controls hud-i'},zoomOut,zoomIn);
    this.mapHelp=h('div',{class:'mm-help'},'');
    ring.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(e.deltaY > 0 ? 1.15 : 1/1.15);
    }, { passive: false });
    this.el = h('div', { class: 'mm' }, this.zoneEl, ring, this.expandButton, this.mapControls, this.mapHelp);
    this.refreshLanguage();
  }

  setSnapshot(s: MapSnapshot): void {
    this.snap = s;
    this.expandedRadius=s.size*.72;
    if(this.expanded)this.radius=this.expandedRadius;
  }

  toggle(force = !this.expanded): void {
    if(force===this.expanded)return;
    if(force&&(this.game.cinematic||this.game.ending.active||!this.game.player.unit.alive))return;
    if(force){this.compactRadius=this.radius;this.radius=this.expandedRadius;}
    else {this.expandedRadius=this.radius;this.radius=this.compactRadius;}
    this.expanded=force;
    this.el.classList.toggle('expanded',force);
    this.canvas.width=this.canvas.height=Math.round((force?760:this.size)*this.dpr);
    this.acc=1;this.refreshLanguage();this.update(0);
    this.expandButton.focus({preventScroll:true});
  }

  private zoom(factor: number): void {
    this.radius=Math.max(this.expanded?40:25,Math.min(this.expanded?450:110,this.radius*factor));
    this.acc=1;
  }

  refreshLanguage(): void {
    this.expandButton.textContent=this.expanded?t('지도 닫기 · G / Esc','Close map · G / Esc'):t('지도 크게 · G','Expand map · G');
    this.expandButton.setAttribute('aria-expanded',String(this.expanded));
    this.mapHelp.textContent=t('★ 퀘스트   ◇ 플레이어   ○ 포탈   ● 보스 · 휠 / + − 확대·축소','★ Quest   ◇ Players   ○ Portal   ● Boss · Wheel / + − to zoom');
    const buttons=this.mapControls.querySelectorAll('button');
    buttons[0].setAttribute('aria-label',t('지도 축소','Zoom out'));buttons[1].setAttribute('aria-label',t('지도 확대','Zoom in'));
  }

  setZone(name: string, combat: boolean): void {
    if (this.zoneEl.textContent !== name) this.zoneEl.textContent = name;
    this.zoneEl.classList.toggle('combat', combat);
  }

  update(dt: number): void {
    if(this.expanded&&(this.game.cinematic||this.game.ending.active||!this.game.player.unit.alive))this.toggle(false);
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    const g = this.game;
    const c = this.ctx;
    const mapSize=this.expanded?Math.max(100,Math.floor(window.innerWidth<=760?Math.min(window.innerWidth*.75,window.innerHeight-210):Math.min(window.innerWidth*.74,window.innerHeight-205,760))):this.size;
    const pixels=Math.round(mapSize*this.dpr);
    if(this.canvas.width!==pixels)this.canvas.width=this.canvas.height=pixels;
    const S = this.canvas.width;
    const half = S / 2;
    const scale = half / this.radius;
    const playerPos = g.player.unit.pos;
    const p = this.expanded&&this.snap?{x:this.snap.minX+this.snap.size/2,z:this.snap.minZ+this.snap.size/2}:playerPos;
    const a = this.expanded?Math.PI:g.follow.forwardYaw;
    const fx = Math.sin(a);
    const fz = Math.cos(a);
    const rx = -Math.cos(a);
    const rz = Math.sin(a);
    const toScreen = (x: number, z: number): [number, number] => {
      const dx = x - p.x;
      const dz = z - p.z;
      return [half + (dx * rx + dz * rz) * scale, half - (dx * fx + dz * fz) * scale];
    };

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath();
    c.arc(half, half, half, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#1d3d52';
    c.fillRect(0, 0, S, S);
    if (this.snap) {
      const s = this.snap;
      const k = s.size / s.canvas.width;
      c.setTransform(
        scale * rx * k,
        -scale * fx * k,
        scale * rz * k,
        -scale * fz * k,
        half + scale * (rx * (s.minX - p.x) + rz * (s.minZ - p.z)),
        half - scale * (fx * (s.minX - p.x) + fz * (s.minZ - p.z)),
      );
      c.imageSmoothingEnabled = true;
      c.drawImage(s.canvas, 0, 0);
      c.setTransform(1, 0, 0, 1, 0, 0);
    }
    // Warm parchment wash so the render reads as a map.
    const grad = c.createRadialGradient(half, half, half * 0.2, half, half, half);
    grad.addColorStop(0, 'rgba(255, 230, 180, 0.04)');
    grad.addColorStop(1, 'rgba(40, 20, 0, 0.45)');
    c.fillStyle = grad;
    c.fillRect(0, 0, S, S);

    const d = this.dpr;
    // POIs
    c.font = `600 ${10 * d}px Georgia, serif`;
    c.textAlign = 'center';
    const icons:ReturnType<typeof shorePoiIcons>=g.world2?.chapter===3?{forge:{label:t('대장간','Forge'),color:'#ffb36b'},tavern:{label:t('항구 광장','Harbor Square'),color:'#ffc995'},shore:{label:t('야자 해안','Palm Coast'),color:'#90e6d4'},wreck:{label:t('파수병 주둔지','Sentinel Camp'),color:'#e4a181'},bossArena:{label:t('황혼 성채','Twilight Citadel'),color:'#ffd58a'}}:g.world2?.chapter===2?{
      forge:{label:t('대장간','Forge'),color:'#ffb36b'},chapel:{label:t('성소','Chapel'),color:'#f6e0a1'},tavern:{label:t('주점','Tavern'),color:'#ffc995'},grove:{label:t('연못','Moonpool'),color:'#bbadff'},shore:{label:t('수정 숲','Crystalwood'),color:'#90e6d4'},wreck:{label:t('유적','Ruins'),color:'#a49eda'},bossArena:{label:t('왕좌','Throne'),color:'#d3a6ff'}
    }:shorePoiIcons();
    for (const [id, info] of Object.entries(icons)) {
      const poi = g.world.pois[id as PoiId];
      if (!poi) continue;
      const [x, y] = toScreen(poi.position.x, poi.position.z);
      if (Math.hypot(x - half, y - half) > half - 6 * d) continue;
      c.fillStyle = info!.color;
      c.strokeStyle = '#000';
      c.lineWidth = 2 * d;
      c.beginPath();
      c.arc(x, y, 3.5 * d, 0, Math.PI * 2);
      c.fill();
      c.stroke();
      c.lineWidth = 3 * d;
      // Keep the whole label inside the round map: below the dot near the top edge, and slid
      // sideways along the rim instead of cut off by it.
      let ly = y - 7 * d;
      if (ly - 10 * d < half - Math.sqrt(Math.max(0, (half - 8 * d) ** 2 - (x - half) ** 2))) ly = y + 14 * d;
      const w = c.measureText(info!.label).width;
      const chord = Math.sqrt(Math.max(0, (half - 10 * d) ** 2 - (ly - 4 * d - half) ** 2));
      const lx = Math.min(Math.max(x, half - chord + w / 2), half + chord - w / 2);
      c.strokeText(info!.label, lx, ly);
      c.fillText(info!.label, lx, ly);
    }
    if(g.world2.chapter===1){
      for(const [wx,wz,label,color] of [...VOYAGE_ISLANDS.map(i=>[i.x,i.z,t(i.ko,i.name),i.color]),[g.boats?.state.x??151,g.boats?.state.z??18.5,t('배','Skiff'),'#ffd58b']] as [number,number,string,string][]){
        const [x,y]=toScreen(wx,wz);if(Math.hypot(x-half,y-half)>half-22*d)continue;c.fillStyle=color;c.strokeStyle='#10202b';c.lineWidth=3*d;c.beginPath();c.arc(x,y,4*d,0,Math.PI*2);c.fill();c.stroke();c.strokeText(label,x,y-9*d);c.fillText(label,x,y-9*d);
      }
    }
    if(g.world2.chapter===3){
      for(const [wx,wz,label] of [[67,72,t('새벽 등대','Dawnwatch')],[-62,48,t('바닷바람 정원','Seabreeze Gardens')]] as [number,number,string][]){const [x,y]=toScreen(wx,wz);if(Math.hypot(x-half,y-half)>half-22*d)continue;c.fillStyle='#ffe2a1';c.strokeStyle='#182932';c.lineWidth=3*d;c.beginPath();c.arc(x,y,4*d,0,Math.PI*2);c.fill();c.stroke();c.strokeText(label,x,y-9*d);c.fillText(label,x,y-9*d);}
    }
    // The two-way portal remains visible while quest and party markers change.
    const portal=g.world2.portalPosition,[portalX,portalY]=toScreen(portal.x,portal.z);
    if(Math.hypot(portalX-half,portalY-half)<half-8*d){c.strokeStyle='#c7b1ff';c.lineWidth=2*d;c.beginPath();c.ellipse(portalX,portalY,4*d,6*d,0,0,Math.PI*2);c.stroke();}
    // Units
    for (const u of g.units) {
      if (u.kind === 'player' || u.hidden || !u.alive) continue;
      const [x, y] = toScreen(u.pos.x, u.pos.z);
      const distance=Math.hypot(x-half,y-half);
      if(u.kind==='remote'){
        const party=g.multiplayer?.mapParty(u),rim=half-8*d,far=distance>rim;
        // Only teammates get long-distance guidance; rivals are shown nearby.
        if(far&&!party?.teammate)continue;
        c.save();c.strokeStyle='#17202c';c.lineWidth=1.6*d;
        c.fillStyle=u.hostile?'#ff756c':PARTY_COLORS[party?.party??0];
        c.beginPath();
        if(far){
          const angle=Math.atan2(y-half,x-half);
          c.translate(half+Math.cos(angle)*rim,half+Math.sin(angle)*rim);c.rotate(angle);
          c.moveTo(5*d,0);c.lineTo(-4*d,-4*d);c.lineTo(-4*d,4*d);
        }else{
          c.moveTo(x,y-5*d);c.lineTo(x+5*d,y);c.lineTo(x,y+5*d);c.lineTo(x-5*d,y);
        }
        c.closePath();c.fill();c.stroke();c.restore();continue;
      }
      if (distance > half - 4 * d) continue;
      if (u.hostile) {
        c.fillStyle = u.kind === 'boss' ? '#ff2a1a' : '#ff4a3a';
        c.beginPath();
        c.arc(x, y, (u.kind === 'boss' ? 5 : 2.6) * d, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#2a0000';
        c.lineWidth = 1 * d;
        c.stroke();
      } else {
        const mark = g.questMark(u);
        if (mark) {
          c.font = `900 ${15 * d}px Georgia, serif`;
          c.lineWidth = 3 * d;
          c.strokeStyle = '#000';
          c.fillStyle = mark === '?' ? '#bdbdb5' : '#ffd200';
          const ch = mark === '!' ? '!' : '?';
          c.strokeText(ch, x, y + 5 * d);
          c.fillText(ch, x, y + 5 * d);
          c.font = `600 ${10 * d}px Georgia, serif`;
        } else if (u.kind === 'npc') {
          c.fillStyle = '#ffe58a';
          c.beginPath();
          c.arc(x, y, 2.4 * d, 0, Math.PI * 2);
          c.fill();
        } else {
          c.fillStyle = 'rgba(160, 230, 140, 0.8)';
          c.beginPath();
          c.arc(x, y, 1.6 * d, 0, Math.PI * 2);
          c.fill();
        }
      }
    }
    // Quest objective: a gold star, pinned to the rim when off the map.
    const obj = g.objectivePos();
    if (obj) {
      let [x, y] = toScreen(obj.x, obj.z);
      const dist = Math.hypot(x - half, y - half);
      const rim = half - 11 * d;
      const pulse = 1 + Math.sin(g.time * 5) * 0.12;
      if (dist > rim) {
        const ang = Math.atan2(y - half, x - half);
        x = half + Math.cos(ang) * rim;
        y = half + Math.sin(ang) * rim;
        c.save();
        c.translate(x, y);
        c.rotate(ang);
        c.fillStyle = '#ffd23a';
        c.strokeStyle = '#3a2400';
        c.lineWidth = 1.5 * d;
        c.beginPath();
        c.moveTo(9 * d * pulse, 0);
        c.lineTo(-5 * d, -7 * d);
        c.lineTo(-2 * d, 0);
        c.lineTo(-5 * d, 7 * d);
        c.closePath();
        c.fill();
        c.stroke();
        c.restore();
      } else {
        star(c, x, y, 7.5 * d * pulse, '#ffd23a');
      }
    }
    c.restore();

    // Player arrow
    const py = g.player.unit.yaw;
    const vx = Math.sin(py) * rx + Math.cos(py) * rz;
    const vy = -(Math.sin(py) * fx + Math.cos(py) * fz);
    const ang = Math.atan2(vy, vx);
    c.save();
    const [playerX,playerY]=toScreen(playerPos.x,playerPos.z);
    c.translate(playerX, playerY);
    c.rotate(ang + Math.PI / 2);
    c.fillStyle = '#ffe9a0';
    c.strokeStyle = '#1a1000';
    c.lineWidth = 2 * d;
    c.beginPath();
    c.moveTo(0, -9 * d);
    c.lineTo(6.5 * d, 7 * d);
    c.lineTo(0, 3.5 * d);
    c.lineTo(-6.5 * d, 7 * d);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();

    // "N" marker on the rim: world -Z is north, which lands at (-rz, fz) on screen.
    // Percentages follow the ring when the compact HUD changes its CSS size.
    this.northEl.style.left = `${(0.5 - rz * 0.5) * 100}%`;
    this.northEl.style.top = `${(0.5 + fz * 0.5) * 100}%`;
  }
}

function star(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  c.save();
  c.translate(x, y);
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath();
  c.fillStyle = fill;
  c.shadowColor = 'rgba(255, 200, 40, 0.9)';
  c.shadowBlur = 8;
  c.fill();
  c.shadowBlur = 0;
  c.strokeStyle = '#3a2400';
  c.lineWidth = 1.5;
  c.stroke();
  c.restore();
}

