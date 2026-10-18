// Presentation-only fixture. Receives Node controller snapshots; no story/gameplay authority in browser.
import * as THREE from 'three';
import {initAssets} from '../src/core/assets';
import {EndingPresentationView} from '../src/multiplayer/endingPresentationView';
const scene=new THREE.Scene();scene.background=new THREE.Color('#1b3042');
const camera=new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.1,100);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(innerWidth,innerHeight);initAssets(renderer);document.body.style.margin='0';document.body.append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xd9f2ff,0x4b3d20,2.8));const light=new THREE.DirectionalLight(0xffd8a0,3);light.position.set(5,12,5);scene.add(light);
const floor=new THREE.Mesh(new THREE.CircleGeometry(13,80),new THREE.MeshStandardMaterial({color:0x846947,roughness:.9}));floor.rotation.x=-Math.PI/2;floor.position.y=-.015;scene.add(floor);
const castRoot=new THREE.Group();scene.add(castRoot);
const liveSentinel=new THREE.Group();liveSentinel.position.set(101,202,303);liveSentinel.userData=Object.freeze({hp:100,xp:123,coins:45,world:'w4'});scene.add(liveSentinel);
const watermark=document.createElement('div');watermark.textContent='PRESENTATION-ONLY FIXTURE - NOT EARNED STORY COMPLETION';watermark.style.cssText='position:fixed;bottom:0;background:#722;color:white;padding:8px;width:100%;text-align:center;font:14px sans-serif;z-index:100;pointer-events:none';document.body.append(watermark);
const commands:unknown[]=[],cues:string[]=[];
const view=new EndingPresentationView({root:castRoot,camera,parent:document.body,command:(id,kind)=>commands.push({id,kind}),cue:value=>cues.push(value),error:message=>console.error(message)});
let running=true;function draw(){if(!running)return;view.render();renderer.render(scene,camera);requestAnimationFrame(draw);}draw();
Object.assign(window,{endingFixture:{view,commands,cues,camera,castRoot,liveSentinel,close(){view.dispose();running=false;renderer.dispose();}}});
