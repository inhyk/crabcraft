import * as THREE from 'three';
import {STAR_FOG_DENSITY,STAR_HORIZON,STAR_MOONLIGHT,STAR_MOON_INTENSITY,STAR_SHADE_GROUND,STAR_SHADE_INTENSITY,STAR_SHADE_SKY,STAR_SKY_GLSL} from './starNight';

/**
 * Starhaven's lights, fog and image-based light, all from starNight.ts. The scene's environment map is the shore's
 * daylight sky unless this replaces it: while the island shows, metals and glass reflect the island's own night
 * (a PMREM of the dome, aurora included, made once), and the shore's map comes back the moment it hides.
 */
export class StarNightRig {
  readonly root=new THREE.Group();
  readonly shade=new THREE.HemisphereLight(STAR_SHADE_SKY,STAR_SHADE_GROUND,STAR_SHADE_INTENSITY);
  private env:THREE.WebGLRenderTarget|null=null;
  private saved:{environment:THREE.Texture|null;intensity:number}|null=null;
  constructor(moon:THREE.DirectionalLight){
    this.root.name='star-night-rig';this.shade.name='star-night-shade';this.root.add(this.shade);
    moon.color.copy(STAR_MOONLIGHT);moon.intensity=STAR_MOON_INTENSITY;
    moon.shadow.bias=-.0004;moon.shadow.normalBias=.035;
  }
  private bake(renderer:THREE.WebGLRenderer){
    const scene=new THREE.Scene();
    const dome=new THREE.Mesh(new THREE.SphereGeometry(100,32,16),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,
      vertexShader:'varying vec3 d;void main(){d=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:`varying vec3 d;${STAR_SKY_GLSL}void main(){gl_FragColor=vec4(starSkyRadiance(d,40.),1.);}`}));
    scene.add(dome);
    const pmrem=new THREE.PMREMGenerator(renderer);this.env=pmrem.fromScene(scene,0,.1,200);pmrem.dispose();
    dome.geometry.dispose();(dome.material as THREE.Material).dispose();
  }
  /** Each shown frame: the night's fog and environment. */
  apply(scene:THREE.Scene,renderer:THREE.WebGLRenderer,camera?:THREE.Camera){
    // The haze lies low: looked through from high above (the overview) there is far less of it in the way.
    const lift=camera?THREE.MathUtils.smoothstep(camera.position.y,25,140):0;
    const fog=scene.fog;if(fog instanceof THREE.FogExp2){fog.color.copy(STAR_HORIZON);fog.density=STAR_FOG_DENSITY*(1-.62*lift);}
    if(!this.env)this.bake(renderer);
    if(scene.environment!==this.env!.texture){this.saved={environment:scene.environment,intensity:scene.environmentIntensity};scene.environment=this.env!.texture;}
    scene.environmentIntensity=1.6;
  }
  /** When the island is not shown: hand the shore's environment back if this rig still holds the scene. */
  release(scene:THREE.Scene){
    if(this.saved&&this.env&&scene.environment===this.env.texture){scene.environment=this.saved.environment;scene.environmentIntensity=this.saved.intensity;}
    this.saved=null;
  }
  dispose(){this.env?.dispose();this.env=null;}
}
