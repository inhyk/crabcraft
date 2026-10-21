// A soft ground contact shadow for the night-elf action inserts. The forest is outside
// the gameplay directional shadow frustum; this stays on the ground during a jump.
import * as THREE from 'three';
import { registerEffect, type Effect, type FxContext } from '../fx';
import type { FxCue } from '../types';

class Contact implements Effect {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  constructor(private cue: FxCue, scene: THREE.Scene) {
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { alpha: { value: 0.32 } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying vec2 vUv; uniform float alpha; void main(){float d=length((vUv-.5)*2.);float a=exp(-d*d*4.5)*(1.-smoothstep(.65,1.,d));gl_FragColor=vec4(.015,.02,.05,a*alpha);}',
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2.8), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  update(ctx: FxContext): void {
    const p = ctx.point({ a: String(this.cue.actor), o: [0, 0, 0] });
    this.mesh.position.set(p.x, ctx.ground(p.x, p.z) + 0.035, p.z);
    const j = this.cue.jump as { takeoff: number; land: number } | null;
    const phase = j ? Math.max(0, Math.min(1, (ctx.t - j.takeoff) / (j.land - j.takeoff))) : 0;
    const air = Math.sin(phase * Math.PI);
    this.material.uniforms.alpha.value = 0.38 - air * 0.23;
    this.mesh.scale.setScalar(1 + air * 0.3);
  }
  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
registerEffect('elf-contact', (cue, scene) => new Contact(cue, scene));
