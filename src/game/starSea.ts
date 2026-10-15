import * as THREE from 'three';
import {STAR_ATMOSPHERE,STAR_MOON_POSITION} from './starAtmosphere';

/** One static plane: animated shading never changes the coast's collision or water level. */
export class StarSea {
  readonly root:THREE.Mesh;
  private readonly time={value:0};
  constructor(){
    const geometry=new THREE.PlaneGeometry(4096,4096);geometry.rotateX(-Math.PI/2);
    const material=new THREE.ShaderMaterial({
      fog:false,uniforms:{time:this.time,moonDirection:{value:new THREE.Vector3(...STAR_MOON_POSITION).normalize()}},
      vertexShader:/* glsl */`
        varying vec3 world;
        void main(){vec4 p=modelMatrix*vec4(position,1.);world=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}
      `,
      fragmentShader:/* glsl */`
        varying vec3 world;
        uniform float time;
        uniform vec3 moonDirection;
        ${STAR_ATMOSPHERE}
        float coastHeight(vec2 p){
          float r=length(vec2(p.x/115.,(p.y-10.)/140.));
          float land=3.+sin(p.x*.08)*cos(p.y*.06)*1.8+max(0.,r-.65)*12.-smoothstep(.83,1.04,r)*21.;
          // The finite terrain ends underwater. Its inland uplift must not create a second coast offshore.
          return mix(land,-35.,smoothstep(1.05,1.2,r));
        }
        void main(){
          vec3 view=normalize(cameraPosition-world);
          float distanceToEye=length(cameraPosition.xz-world.xz);
          float detail=1.-smoothstep(30.,220.,distanceToEye);
          float p1=dot(world.xz,vec2(.8,.6))*.35-time*.5+sin(world.z*.073+time*.18)*1.3;
          float p2=dot(world.xz,vec2(-.4,.9))*.48+time*.38+sin(world.x*.053-time*.13)*1.8;
          float swell=dot(world.xz,vec2(.7,-.5))*.16-time*.24;
          float wave1=detail*(1.-smoothstep(.45,2.,fwidth(p1)));
          float wave2=detail*(1.-smoothstep(.45,2.,fwidth(p2)));
          float broad=1.-smoothstep(.45,2.,fwidth(swell));
          vec3 normal=normalize(vec3(sin(p1)*.012*wave1+cos(p2)*.008*wave2+sin(swell)*.007*broad,
            1.,cos(p1)*.009*wave1+sin(p2)*.007*wave2+cos(swell)*.005*broad));
          vec3 reflected=reflect(-view,normal);
          float depth=max(0.,world.y-coastHeight(world.xz));
          float shallows=1.-smoothstep(.2,7.,depth);
          vec3 water=mix(vec3(.007,.015,.035),vec3(.016,.065,.078),shallows);
          float fresnel=.04+.96*pow(1.-max(0.,dot(view,normal)),5.);
          vec3 reflection=starAtmosphere(reflected,time);
          reflection=mix(reflection,vec3(.045,.045,.09),.28);
          vec3 color=mix(water,reflection,fresnel*.65);
          vec3 halfLight=normalize(view+moonDirection);
          float glint=pow(max(0.,dot(normal,halfLight)),96.);
          color+=glint*vec3(.24,.23,.31)*(.65+.35*sin(p1+p2));
          float front=.38+.12*sin(time*.8+world.x*.025);
          float foam=exp(-pow((depth-front)/.38,2.))*smoothstep(0.,.12,depth);
          foam*=.65+.35*sin(world.x*.7+world.z*.4-time*.5);
          color+=foam*vec3(.09,.18,.17);
          vec3 horizon=starAtmosphere(vec3(reflected.x,0.,reflected.z),time)*.8;
          color=mix(color,horizon,smoothstep(350.,1250.,distanceToEye));
          gl_FragColor=vec4(color,1.);
        }
      `,
    });
    this.root=new THREE.Mesh(geometry,material);this.root.name='star-island-sea';this.root.position.y=-3;
  }
  update(time:number){this.time.value=time;}
}
