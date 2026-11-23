"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createCaptureTransactions } = require("../src/capture-transaction");
const { coordinateCapture } = require("../src/capture-coordinator");

function fixture() {
  let clock=10010, verify=async()=>true, releaseCapture;
  const cameras={};
  for(const [role,value] of Object.entries({front:"T578DZE",rear:"T816EQL",container:"CAIU9720214"})) cameras[role]=async({sessionId})=>({sessionId,role,eventId:`${role}-1`,value,capturedAt:10005,timestampResolutionMs:1,clockUncertaintyMs:1});
  const manager=createCaptureTransactions({newId:()=>"capture-1",now:()=>clock,maxHoldMs:1000,verifyCurrent:(capture)=>verify(capture),performCapture:async({id,maxSkewMs})=>{
    if(releaseCapture) await releaseCapture;
    return coordinateCapture({id,maxSkewMs,cameras,now:()=>clock,deadlineMs:11000,maxWeightAgeMs:100,maxWeightDeltaKg:0.5,readScale:async()=>({connected:true,stable:true,value:45340,sampleAt:10000,uncertaintyMs:1,cycleId:"truck-1"})});
  }});
  return {manager,setClock:value=>{clock=value;},setVerify:value=>{verify=value;},setCaptureDelay:value=>{releaseCapture=value;}};
}

test("capture transaction saves only the session's validated device values and is single-use",async()=>{
  const {manager}=fixture();const captured=await manager.capture();
  captured.cameras.front.value="ALTERED"; captured.weightKg=1;
  let sent;const saved=await manager.save("capture-1",async payload=>{sent=payload;return "saved";});
  assert.equal(saved,"saved");assert.equal(sent.requestId,"capture-1");assert.equal(sent.weightKg,45340);
  assert.equal(sent.frontPlate,"T578DZE");assert.equal(sent.rearPlate,"T816EQL");assert.equal(sent.containerNumber,"CAIU9720214");
  assert.deepEqual(Object.keys(sent.evidence).sort(),["cameras","id","maxSkewMs","weightAt","weightKg","weightUncertaintyMs"].sort());
  await assert.rejects(manager.save("capture-1",async()=>{}),/no longer valid/);
});

test("capture is invalidated by device change, expiry and mismatched ID",async()=>{
  let f=fixture();await f.manager.capture();f.manager.invalidate();await assert.rejects(f.manager.save("capture-1",async()=>{}),/no longer valid/);
  f=fixture();await f.manager.capture();f.setClock(11011);await assert.rejects(f.manager.save("capture-1",async()=>{}),/expired/);
  f=fixture();await f.manager.capture();await assert.rejects(f.manager.save("different",async()=>{}),/no longer valid/);
  f=fixture();await f.manager.capture();f.setVerify(async()=>false);await assert.rejects(f.manager.save("capture-1",async()=>{}),/Device state changed/);
});

test("invalidation during a device recheck prevents save",async()=>{
  const f=fixture();await f.manager.capture();let release;f.setVerify(()=>new Promise(resolve=>{release=resolve;}));let saved=false;
  const pending=f.manager.save("capture-1",async()=>{saved=true;});
  await new Promise(resolve=>setImmediate(resolve));f.manager.invalidate();release(true);
  await assert.rejects(pending,/no longer valid/);assert.equal(saved,false);
});

test("invalidation during capture prevents a late result from becoming valid",async()=>{
  const f=fixture();let release;f.setCaptureDelay(new Promise(resolve=>{release=resolve;}));
  const pending=f.manager.capture();f.manager.invalidate();release();
  await assert.rejects(pending,/invalidated/);await assert.rejects(f.manager.save("capture-1",async()=>{}),/no longer valid/);
});

test("failed save consumes the session rather than silently resubmitting uncertain data",async()=>{
  const f=fixture();await f.manager.capture();await assert.rejects(f.manager.save("capture-1",async()=>{throw new Error("connection lost");}),/connection lost/);
  await assert.rejects(f.manager.save("capture-1",async()=>{}),/no longer valid/);
});
test("an error rechecking live devices invalidates the capture",async()=>{
  const f=fixture();await f.manager.capture();f.setVerify(async()=>{throw new Error("scale offline");});
  await assert.rejects(f.manager.save("capture-1",async()=>{}),/scale offline/);
  await assert.rejects(f.manager.save("capture-1",async()=>{}),/no longer valid/);
});
test("a previously accepted camera event cannot be reused in another capture",async()=>{
  const f=fixture();await f.manager.capture();f.manager.invalidate();
  await assert.rejects(f.manager.capture(),/already used/);
});
