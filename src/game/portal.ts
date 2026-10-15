import * as THREE from 'three';

/** Two worlds share the same crafted stone-and-starlight gateway. */
export class StarPortal {
  readonly root=new THREE.Group();
  private inner:THREE.Mesh;
  private dust:THREE.Points;
  private mist:THREE.Mesh;
  constructor(position:THREE.Vector3,label:string) {
    this.root.position.copy(position);this.root.name=label;
    const stone=new THREE.MeshStandardMaterial({color:'#454b61',roughness:.72,metalness:.25});
    const trim=new THREE.MeshStandardMaterial({color:'#ba9b65',roughness:.4,metalness:.75});
    const violet=new THREE.MeshStandardMaterial({color:'#c8adff',emissive:'#6636d9',emissiveIntensity:1.8,metalness:.5,roughness:.25});
    const cyan=new THREE.MeshStandardMaterial({color:'#a4fff2',emissive:'#2ab9c3',emissiveIntensity:1.6,metalness:.45,roughness:.3});
    for(let i=0;i<3;i++){const base=new THREE.Mesh(new THREE.CylinderGeometry(3.8-i*.35,4-i*.35,.22,48),i===2?trim:stone);base.position.y=.11+i*.2;base.receiveShadow=true;this.root.add(base);}
    for(let i=0;i<13;i++) {
      const a=i/12*Math.PI,block=new THREE.Mesh(new THREE.BoxGeometry(.74,1.03,.85),stone);
      block.position.set(Math.cos(a)*3.25,1.15+Math.sin(a)*4.1,0);block.rotation.z=a-Math.PI/2;block.castShadow=true;this.root.add(block);
      const rune=new THREE.Mesh(new THREE.OctahedronGeometry(.14),i%2?cyan:violet);rune.position.copy(block.position);rune.position.z=.5;this.root.add(rune);
    }
    for(const side of [-1,1]){const pillar=new THREE.Mesh(new THREE.CylinderGeometry(.45,.65,1.8,8),stone);pillar.position.set(side*3.2,1.5,0);pillar.castShadow=true;this.root.add(pillar);}
    const outer=new THREE.Mesh(new THREE.TorusGeometry(2.8,.075,8,96),violet);outer.scale.y=1.27;outer.position.y=3.25;this.root.add(outer);
    this.inner=new THREE.Mesh(new THREE.TorusGeometry(2.55,.045,6,96),cyan);this.inner.scale.y=1.27;this.inner.position.y=3.25;this.root.add(this.inner);
    const shader=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{time:{value:0}},vertexShader:'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 v;uniform float time;void main(){vec2 p=(v-.5)*2.;float r=length(p);float swirl=sin(atan(p.y,p.x)*5.+r*13.-time*1.3);float edge=smoothstep(1.,.5,r);vec3 c=mix(vec3(.1,.6,.65),vec3(.4,.13,.8),swirl*.5+.5);gl_FragColor=vec4(c,(.09+.07*swirl)*edge);}' });
    this.mist=new THREE.Mesh(new THREE.CircleGeometry(2.5,64),shader);this.mist.position.y=3.25;this.mist.scale.y=1.27;this.root.add(this.mist);
    const coords=new Float32Array(72*3);for(let i=0;i<72;i++){const a=i*2.39996,r=2.7+Math.sin(i*8.3)*.4;coords.set([Math.cos(a)*r,3.3+Math.sin(a)*r*1.27,Math.sin(i*3.7)*.7],i*3);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(coords,3));this.dust=new THREE.Points(geo,new THREE.PointsMaterial({color:'#bdfff6',size:.065,transparent:true,opacity:.85,depthWrite:false}));this.root.add(this.dust);
    const light=new THREE.PointLight('#7b8dff',12,14,1.4);light.position.set(0,3,1);this.root.add(light);
  }
  update(time:number){this.inner.rotation.y=Math.sin(time*.3)*.15;this.dust.rotation.y=time*.06;(this.mist.material as THREE.ShaderMaterial).uniforms.time.value=time;}
}
