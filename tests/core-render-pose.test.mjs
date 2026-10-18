import test from 'node:test';
import assert from 'node:assert/strict';
import {createUnit} from '../src/sim/unit.ts';
import {Actions} from '../src/sim/actions.ts';
import {realActionData,actionRequest,BREAK_ROUTINE} from '../src/sim/data/actions.ts';
import {advanceNumericPose} from '../src/sim/pose.ts';
import {createRenderPoseRecipe,evaluateRenderPoseRecipe,isRenderPoseRecipe,RENDER_POSE_RECIPE_VERSION,renderPoseProviderVersion} from '../src/sim/renderPose.ts';
const make=(id=1,race='human')=>createUnit({area:'recipe',id,life:1},race,'player','player',realActionData);
const applied=u=>({appliedQ:u.pose.appliedQ,appliedPosition:u.pose.appliedPosition,appliedRotation:u.pose.appliedRotation});
function verify(u){const recipe=createRenderPoseRecipe(u),before=structuredClone(u);assert.ok(isRenderPoseRecipe(recipe));assert.deepEqual(evaluateRenderPoseRecipe(recipe),applied(u));assert.deepEqual(evaluateRenderPoseRecipe(structuredClone(recipe)),applied(u));assert.deepEqual(u,before);return recipe;}

test('spawn recipe is explicit HOME and uses the shipped provider/version',()=>{const u=make();assert.deepEqual(verify(u),{version:RENDER_POSE_RECIPE_VERSION,locomotion:null,layers:[]});assert.equal(renderPoseProviderVersion,realActionData.version);});

test('last-applied locomotion/action recipes reproduce every Float32 component through changing gaits/fades/root commits',()=>{
 for(const race of ['human','undead','frost','townsfolk:3']){
  const u=make(1,race),actions=new Actions(realActionData,()=>{},()=>{});verify(u);
  for(let i=0;i<800;i++){
   u.pose.localVx=Math.sin(i*.091)*2.2;u.pose.localVz=Math.cos(i*.057)*4;u.pose.yawRate=Math.sin(i*.031)*1.8;
   if(i%97===0){const move=BREAK_ROUTINE[Math.floor(i/97)%6];actions.play(u,actionRequest(realActionData,move.id,{...move,carryRoot:true,fade:i%3===0?0:.12}));}
   if(i%71===0)actions.play(u,actionRequest(realActionData,'cast',{part:'channel',loop:true,upper:true}));
   if(i%41===0)actions.stop(u,undefined,.15);
   actions.update(u,1/30);advanceNumericPose(u,1/30);verify(u);
  }
 }
});

test('full-body cover retains the exact prior locomotion sample while controller clocks continue',()=>{
 const u=make(),actions=new Actions(realActionData,()=>{},()=>{});u.pose.localVz=3;
 for(let i=0;i<12;i++)advanceNumericPose(u,1/30);
 actions.play(u,actionRequest(realActionData,'sit',{fade:0}));actions.update(u,1/30);advanceNumericPose(u,1/30);
 assert.equal(u.actions[0].weight,1);const cached=createRenderPoseRecipe(u).locomotion,oldClock=u.pose.locomotionTime;
 for(let i=0;i<100;i++){u.pose.localVx=2;u.pose.localVz=-3;u.pose.yawRate=.6;actions.update(u,1/30);advanceNumericPose(u,1/30);verify(u);assert.deepEqual(createRenderPoseRecipe(u).locomotion,cached);}
 assert.ok(u.pose.locomotionTime>oldClock+3);assert.notEqual(cached[4],u.pose.locomotionTime);
 actions.stop(u,undefined,.1);for(let i=0;i<8;i++){actions.update(u,1/30);advanceNumericPose(u,1/30);verify(u);}
 assert.notDeepEqual(createRenderPoseRecipe(u).locomotion,cached);
});

test('cancellation/replacement before pose stage cannot rewrite previously applied layer inputs',()=>{
 const u=make(),actions=new Actions(realActionData,()=>{},()=>{});
 actions.play(u,actionRequest(realActionData,'break_sixstep',{from:.835,to:5.235,carryRoot:true}));
 for(let i=0;i<55;i++){actions.update(u,1/30);advanceNumericPose(u,1/30);}
 const recipe=createRenderPoseRecipe(u),snapshot=structuredClone(recipe),pose=structuredClone(applied(u)),root=[u.x,u.z,u.yaw];
 actions.stop(u);assert.notDeepEqual([u.x,u.z,u.yaw],root);assert.deepEqual(recipe,snapshot);assert.deepEqual(evaluateRenderPoseRecipe(recipe),pose);assert.equal(createRenderPoseRecipe(u),recipe);
 actions.play(u,actionRequest(realActionData,'cast',{part:'release',upper:true}));assert.deepEqual(evaluateRenderPoseRecipe(createRenderPoseRecipe(u)),pose);
 assert.throws(()=>{recipe.layers[0].time=99;},TypeError);
 actions.update(u,1/30);advanceNumericPose(u,1/30);verify(u);
});

test('interleaved recipe readers have no clock, RNG or shared scratch state',()=>{
 const a=make(),b=make(2,'tauren');a.pose.localVz=2;b.pose.localVx=-3;
 for(let i=0;i<80;i++){advanceNumericPose(a,1/30);const recipe=createRenderPoseRecipe(a),expected=evaluateRenderPoseRecipe(recipe);advanceNumericPose(b,1/17);verify(b);assert.deepEqual(evaluateRenderPoseRecipe(recipe),expected);verify(a);}
});

test('recipe validation rejects missing/unknown layers, nonfinite clocks, version mismatch and array substitutes',()=>{
 const good={version:1,locomotion:[.1,.2,.3,.4,.5],layers:[{id:'cast',time:1.5,weight:.5,loop:true,upper:true,carryRoot:false,rebase:{x:0,z:0,yaw:0}}]};assert.ok(isRenderPoseRecipe(good));
 for(const bad of [null,{}, {...good,version:2},{...good,locomotion:[0,0,0,0,Infinity]},{...good,locomotion:[]},{...good,appliedQ:[]},{...good,layers:[{...good.layers[0],id:'missing'}]},{...good,layers:[{...good.layers[0],weight:NaN}]},{...good,layers:[{...good.layers[0],rebase:{x:0,z:0}}]}])assert.equal(isRenderPoseRecipe(bad),false);
 assert.throws(()=>evaluateRenderPoseRecipe({...good,version:2}),/Unsupported/);
});
