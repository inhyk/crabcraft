import type * as THREE from 'three';

/** Keep every warning vertex above the real surface, including the uneven Starhaven terrain. */
export function conformTelegraph(geometry: THREE.BufferGeometry, at: THREE.Vector3, yaw: number, halfWidth: number, halfLength: number, heightAt: (x: number, z: number) => number): void {
  const positions = geometry.getAttribute('position');
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) * halfWidth, z = positions.getZ(i) * halfLength;
    const ground = heightAt(at.x + x * cos + z * sin, at.z - x * sin + z * cos);
    positions.setY(i, (Number.isFinite(ground) ? ground : at.y) + 0.28 - at.y);
  }
  positions.needsUpdate = true;
}
