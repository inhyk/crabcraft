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
          // Every train's crests bend with slow noise, so seen from above no crest line runs straight across the bay.
          float sw=nsN2(world.xz*.012+time*.01)*6.28,sw2=nsN2(world.xz*.031-time*.013+7.)*6.28;
          float p1=dot(world.xz,vec2(.8,.6))*.35-time*.5+sin(world.z*.073+time*.18)*1.3+sw*1.4+sw2*.6;
          float p2=dot(world.xz,vec2(-.4,.9))*.48+time*.38+sin(world.x*.053-time*.13)*1.8-sw*1.1+sw2*.8;
          float wave1=detail*(1.-smoothstep(.45,2.,fwidth(p1)));
          float wave2=detail*(1.-smoothstep(.45,2.,fwidth(p2)));
          // Swell: three trains crossing, their phases bent by slow noise, so no single crest line repeats across
          // the bay; it fades out with distance where it would alias into stripes, and a rougher glint takes over.
          float s1=dot(world.xz,vec2(.7,-.5))*.16-time*.24+sw,s2=dot(world.xz,vec2(-.2,-.95))*.11-time*.19+sw*.7,s3=dot(world.xz,vec2(.95,.3))*.21-time*.3-sw*.5;
          float broad=1.-smoothstep(60.,320.,distanceToEye);
          vec3 normal=normalize(vec3(sin(p1)*.012*wave1+cos(p2)*.008*wave2+(sin(s1)*.004+sin(s2)*.003+sin(s3)*.003)*broad,
            1.,cos(p1)*.009*wave1+sin(p2)*.007*wave2+(cos(s1)*.003+cos(s2)*.004+cos(s3)*.002)*broad));
          vec3 reflected=reflect(-view,normal);
          float depth=max(0.,world.y-coastHeight(world.xz));
          // Shallows fade out over a wide band (no hard teal ring round the island from above), deep blue-green.
          float shallows=pow(1.-smoothstep(.2,14.,depth),1.6);
          vec3 water=mix(vec3(.007,.015,.035),vec3(.014,.045,.06),shallows);
          float fresnel=.04+.96*pow(1.-max(0.,dot(view,normal)),5.);
          // The sky without the eclipse's ring (a ring broken up by waves reads as a melted blot): the corona's light
          // comes back instead as a glitter path, a narrow column stretched toward the eye under the eclipse.
          vec3 reflection=starGradient(reflected)+starAuroraGlow(reflected,time)*.09;
          reflection=mix(reflection,vec3(.045,.045,.09),.28);
          // The eclipse in the water as a still mirror sees it: the disc dark, the corona round it (a smooth reflection keeps
          // the disc a clean shape instead of a wave-broken blot); the glitter path below carries the waves.
          float disc;
          {
            vec3 calm=reflect(-view,vec3(0.,1.,0.));
            vec2 ce=starEclipseAt(calm);
            disc=(1.-smoothstep(.93,1.05,ce.x))*step(0.,calm.y);
            reflection=reflection*(1.-.85*disc)+starEclipseLight(ce,time,false)*.22*step(0.,calm.y);
          }
          float eclPath;
          {
            vec3 rd=normalize(reflected);
            float daz=atan(rd.x,-rd.z)-atan(STAR_ECL.x,-STAR_ECL.z);
            float del=asin(clamp(rd.y,-1.,1.))-asin(STAR_ECL.y);
            float path=exp(-daz*daz/.0025)*exp(-abs(del)/.1)*smoothstep(.02,.35,(cameraPosition.z-world.z)/max(distanceToEye,1.));
            // Glitter from wave facets (noise, not the swell's regular crests), none inside the mirrored disc.
            float sparkle=.35+.65*smoothstep(.45,.85,nsN2(world.xz*vec2(1.6,.5)+vec2(time*.4,-time*.25)));
            eclPath=path*sparkle*.6*(1.-disc);
          }
          vec3 color=mix(water,reflection,fresnel*.65)+vec3(.92,.87,.74)*eclPath;
          vec3 halfLight=normalize(view+moonDirection);
          // Waves too small to draw still scatter the moon: the farther, the broader and dimmer its glint.
          float shin=mix(14.,96.,detail);
          float glint=pow(max(0.,dot(normal,halfLight)),shin)*(shin+8.)/104.;
          color+=glint*vec3(.24,.23,.31)*(.65+.35*sin(p1+p2)*detail+.35*(1.-detail));
          // Surf: a thin broken line of white water at the beach and a fainter second line further out, lacy, not a band.
          float front=.3+.1*sin(time*.8+world.x*.025);
          float lace=smoothstep(.35,.75,nsN2(world.xz*.9+vec2(time*.15,-time*.1))*.7+nsN2(world.xz*3.1-time*.2)*.3);
          float foam=exp(-pow((depth-front)/.22,2.))*smoothstep(0.,.08,depth)*(.35+.65*lace);
          foam+=exp(-pow((depth-1.6-.4*sin(time*.5+world.z*.03))/.35,2.))*lace*.3;
          color+=foam*vec3(.16,.19,.22);
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
