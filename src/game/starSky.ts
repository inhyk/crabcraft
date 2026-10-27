import * as THREE from 'three';
import {STAR_ATMOSPHERE,STAR_MOON_POSITION} from './starAtmosphere';

/** Stars on the dome; a third of them crowd the milky band (starNight.ts's great circle). */
export const STAR_POINT_COUNT=2400;

/** Celestial layers stay beyond the island mist; terrain still occludes them normally. */
export class StarSky {
  readonly root=new THREE.Group();
  private readonly time={value:0};
  private readonly pixelRatio={value:1};

  constructor(){
    this.root.name='star-island-sky';
    const dome=new THREE.Mesh(new THREE.SphereGeometry(800,48,24),new THREE.ShaderMaterial({
      side:THREE.BackSide,depthWrite:false,fog:false,uniforms:{time:this.time},
      vertexShader:'varying vec3 direction;void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:/* glsl */`
        varying vec3 direction;
        uniform float time;
        ${STAR_ATMOSPHERE}
        void main(){
          gl_FragColor=vec4(starSkyRadiance(direction,time),1.);
        }
      `,
    }));
    dome.name='star-aurora-dome';this.root.add(dome);

    const positions=new Float32Array(STAR_POINT_COUNT*3),seeds=new Float32Array(STAR_POINT_COUNT);
    const random=(i:number)=>{const n=Math.sin(i*127.1+41.7)*43758.5453;return n-Math.floor(n);};
    const band=new THREE.Vector3(.55,.32,.77).normalize(),u=new THREE.Vector3().crossVectors(band,new THREE.Vector3(0,1,0)).normalize(),v=new THREE.Vector3().crossVectors(band,u),p=new THREE.Vector3();
    for(let i=0;i<seeds.length;i++){
      if(i%3===0){
        // In the band: round the great circle, within a few degrees of it.
        const a=random(i+900)*Math.PI*2,off=(random(i+1400)+random(i+2400)-1)*.16;
        p.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(v,Math.sin(a)).addScaledVector(band,off).normalize();
        if(p.y<.03)p.y=Math.abs(p.y)+.03;p.normalize();
      }else{
        const a=random(i+900)*Math.PI*2,y=.015+random(i+1400)*.97,r=Math.sqrt(1-y*y);p.set(Math.sin(a)*r,y,Math.cos(a)*r);
      }
      positions.set([p.x*650,p.y*650,p.z*650],i*3);seeds[i]=random(i+1900);
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('seed',new THREE.BufferAttribute(seeds,1));
    const stars=new THREE.Points(geometry,new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,fog:false,blending:THREE.AdditiveBlending,uniforms:{time:this.time,pixelRatio:this.pixelRatio},
      vertexShader:/* glsl */`
        attribute float seed;
        uniform float time;
        uniform float pixelRatio;
        varying float brightness;
        varying vec3 tint;
        void main(){
          // Few bright stars, many faint: a power law, with a slow twinkle and stars near the horizon dimmed.
          float mag=pow(seed,3.);
          brightness=(.28+.9*mag)*(.8+.2*sin(time*(.55+seed)+seed*41.))*smoothstep(.0,.18,normalize(position).y);
          tint=mix(vec3(.62,.75,1.),vec3(1.,.86,.66),fract(seed*7.31));
          vec4 view=modelViewMatrix*vec4(position,1.);
          gl_Position=projectionMatrix*view;
          gl_PointSize=(1.2+mag*3.2)*pixelRatio;
        }
      `,
      fragmentShader:/* glsl */`
        varying float brightness;
        varying vec3 tint;
        void main(){
          float r=length(gl_PointCoord-.5)*2.;
          if(r>1.)discard;
          float glow=exp(-r*r*3.)*(1.-smoothstep(.65,1.,r));
          gl_FragColor=vec4(tint*1.5,glow*brightness);
        }
      `,
    }));
    stars.name='star-celestial-points';this.root.add(stars);

    // A waxing gibbous moon: limb darkening, grey maria and a soft terminator; its halo is in the dome.
    const moon=new THREE.Mesh(new THREE.SphereGeometry(19,40,28),new THREE.ShaderMaterial({
      fog:false,transparent:true,depthWrite:false,vertexShader:'varying vec3 surface;varying vec3 viewDir;void main(){surface=normal;vec4 w=modelMatrix*vec4(position,1.);viewDir=normalize(cameraPosition-w.xyz);gl_Position=projectionMatrix*viewMatrix*w;}',
      fragmentShader:/* glsl */`
        varying vec3 surface;
        varying vec3 viewDir;
        float mh(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
        float mn(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
          return mix(mix(mix(mh(i),mh(i+vec3(1,0,0)),f.x),mix(mh(i+vec3(0,1,0)),mh(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(mh(i+vec3(0,0,1)),mh(i+vec3(1,0,1)),f.x),mix(mh(i+vec3(0,1,1)),mh(i+1.),f.x),f.y),f.z);}
        void main(){
          vec3 n=normalize(surface);
          float facing=max(dot(n,normalize(viewDir)),0.);
          // Lit from a sun a little behind and to the side: a gibbous phase.
          float lit=smoothstep(-.12,.18,dot(n,normalize(viewDir+vec3(.55,.1,.2))));
          float maria=smoothstep(.45,.7,mn(n*2.6)*.65+mn(n*6.1)*.35);
          float craters=mn(n*17.)*.12;
          vec3 c=vec3(1.45,1.42,1.38)*(1.-.32*maria-craters)*(.55+.45*pow(facing,.5));
          gl_FragColor=vec4(mix(vec3(.012,.014,.03),c,lit),1.);
        }
      `,
    }));
    moon.name='star-crescent-moon';moon.position.set(...STAR_MOON_POSITION);moon.renderOrder=1;this.root.add(moon);
  }

  update(time:number,camera:THREE.Camera,pixelRatio:number){this.time.value=time;this.pixelRatio.value=pixelRatio;this.root.position.copy(camera.position);}
}
