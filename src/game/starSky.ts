import * as THREE from 'three';

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
        void main(){
          vec3 d=normalize(direction);
          float a=atan(d.z,d.x),t=time*.025;
          float horizon=exp(-max(0.,d.y)*4.5);
          vec3 color=mix(vec3(.009,.012,.04),vec3(.058,.038,.105),horizon);
          float height=.115+.045*sin(a*3.+t)+.025*sin(a*7.-t*.7);
          float folds=.28+.72*pow(.5+.5*sin(a*29.+sin(a*7.-t)*2.),2.);
          float ribbon=exp(-pow((d.y-height)/.055,2.))*folds;
          float high=exp(-pow((d.y-height-.09-.03*sin(a*5.+t*.8))/.075,2.));
          float veil=smoothstep(.005,.065,d.y)*(1.-smoothstep(.35,.6,d.y));
          float hue=.5+.5*sin(a*4.+t*.4);
          color+=veil*(ribbon*mix(vec3(.045,.42,.29),vec3(.15,.12,.43),hue)*.7
            +high*vec3(.105,.055,.2)*.35);
          gl_FragColor=vec4(color,1.);
        }
      `,
    }));
    dome.name='star-aurora-dome';this.root.add(dome);

    const positions=new Float32Array(980*3),seeds=new Float32Array(980);
    const random=(i:number)=>{const n=Math.sin(i*127.1+41.7)*43758.5453;return n-Math.floor(n);};
    for(let i=0;i<seeds.length;i++){
      const a=random(i+900)*Math.PI*2,y=.015+random(i+1400)*.97,r=Math.sqrt(1-y*y);
      positions.set([Math.sin(a)*r*650,y*650,Math.cos(a)*r*650],i*3);seeds[i]=random(i+1900);
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
          brightness=(.45+.55*seed)*(.82+.18*sin(time*(.55+seed)+seed*41.));
          tint=mix(vec3(.65,.78,1.),vec3(1.,.88,.69),seed);
          vec4 view=modelViewMatrix*vec4(position,1.);
          gl_Position=projectionMatrix*view;
          gl_PointSize=(1.3+seed*2.1)*pixelRatio;
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

    const moon=new THREE.Mesh(new THREE.SphereGeometry(20,32,24),new THREE.ShaderMaterial({
      fog:false,transparent:true,depthWrite:false,vertexShader:'varying vec3 surface;void main(){surface=normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:/* glsl */`
        varying vec3 surface;
        void main(){
          vec3 n=normalize(surface);
          float incidence=dot(n,normalize(vec3(-.93,.15,-.32)));
          float sunlight=smoothstep(-.025,.06,incidence);
          float terrain=.86+.07*sin(n.x*31.+sin(n.y*19.)*2.)*sin(n.z*37.+n.y*11.);
          vec3 lit=vec3(1.25,1.12,1.45)*terrain*(.65+.35*max(0.,incidence));
          gl_FragColor=vec4(mix(vec3(.022,.018,.045),lit,sunlight),mix(.06,1.,sunlight));
        }
      `,
    }));
    moon.name='star-crescent-moon';moon.position.set(-150,65,-600);moon.renderOrder=1;this.root.add(moon);
  }

  update(time:number,camera:THREE.Camera,pixelRatio:number){this.time.value=time;this.pixelRatio.value=pixelRatio;this.root.position.copy(camera.position);}
}
