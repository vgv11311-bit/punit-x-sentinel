"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createCaptureSession}=require("../src/capture-session");
const setup=()=>createCaptureSession({id:"cycle-1",weightKg:45340,weightAt:10000,weightUncertaintyMs:1,maxSkewMs:100,deadlineMs:15000});
const event=(role,id,value,time=10010)=>({sessionId:"cycle-1",role,eventId:id,value,capturedAt:time,timestampResolutionMs:1,clockUncertaintyMs:1});
test("capture session accepts three distinct, timely role events",()=>{const c=setup();c.add(event("front","f","FRONT"),10100);c.add(event("rear","r","REAR",10050),10200);c.add(event("container","c","CAIU9720214",10005),10300);assert.equal(c.complete(10400).cameras.rear.value,"REAR");});
test("capture session fails closed on wrong cycle, stale, duplicate and conflicting events",()=>{
 let c=setup(); assert.throws(()=>c.add({...event("front","f","FRONT"),sessionId:"other"},10100),/unrelated/);assert.throws(()=>c.complete(10200),/unrelated/);
 c=setup();assert.throws(()=>c.add(event("front","f","FRONT",9899),10100),/follow/);
 c=setup();assert.throws(()=>c.add(event("front","f","FRONT",10150),10200),/outside/);
 c=setup();assert.throws(()=>c.add({...event("front","f","FRONT"),timestampResolutionMs:1000},10100),/uncertainty/);
 c=setup();c.add(event("front","same","FRONT"),10100);assert.throws(()=>c.add(event("rear","same","REAR"),10100),/reused/);
 c=setup();c.add(event("front","f","A"),10100);assert.throws(()=>c.add(event("front","f2","B"),10100),/conflicting/i);
 c=setup();c.add(event("front","f","A"),10100);assert.throws(()=>c.add(event("front","f","A"),10100),/Duplicate/);
 c=setup();assert.throws(()=>c.complete(15001),/expired/);assert.throws(()=>setup().complete(10100),/three/);
});
test("completed capture sessions cannot be changed or completed twice",()=>{
 const c=setup();for(const role of ["front","rear","container"])c.add(event(role,role,role),10100);
 const result=c.complete(10200);assert.equal(result.cameras.front.value,"front");
 assert.throws(()=>c.add(event("front","f2","OTHER"),10300),/complete/);
 assert.throws(()=>c.complete(10300),/complete/);
});
test("one-second limit includes timestamp precision and clock uncertainty",()=>{
 const options={id:"cycle-1",weightKg:45340,weightAt:10000,weightUncertaintyMs:10,maxSkewMs:1000,deadlineMs:15000};
 const timely={...event("front","f","FRONT",10970),timestampResolutionMs:10,clockUncertaintyMs:10};
 const valid=createCaptureSession(options); valid.add(timely,11000);
 const late=createCaptureSession(options); assert.throws(()=>late.add({...timely,capturedAt:10971},11000),/outside/);
 assert.throws(()=>createCaptureSession({...options,maxSkewMs:1001}),/Invalid/);
 const coarse=createCaptureSession(options); assert.throws(()=>coarse.add({...timely,capturedAt:10020,timestampResolutionMs:1000},11000),/uncertainty/);
});
