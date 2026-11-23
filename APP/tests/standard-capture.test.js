"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {createStandardCapture} = require("../src/standard-capture");
function fixture() {
  const f = {time:100000,journal:null,calls:[],count:0};
  f.devices = {scale:{connected:true,stable:true,value:45340,at:99900,device:"COM3"},cameras:Object.fromEntries(["front","rear","container"].map((role,i)=>[role,{connected:true,value:["T578DZE","T816EQL","CAIU9720214"][i],at:99000}]))};
  f.definitions = ["vehiclePlate","trailer_no","container_no","driverName"].map((key,i)=>({key,serverId:i+1,serverKey:key,required:true,label:key,type:"text"}));
  f.make = () => createStandardCapture({readDevices:()=>f.devices,readJournal:()=>f.journal,writeJournal:value=>{f.journal=structuredClone(value)},send:async body=>{f.calls.push(body);return f.send ? f.send(body) : {record:{id:"remote-1"}}},now:()=>f.time,newId:()=>`test-${++f.count}`});
  f.tx=f.make(); f.capture=()=>f.tx.capture({owner:"op",confirmed:true}); f.save=(id,fields={driverName:"Driver",vehiclePlate:"FORGED",trailer_no:"FORGED",container_no:"FORGED"})=>f.tx.save({id,owner:"op",fields,definitions:f.definitions});
  return f;
}
test("standard Capture and Save freeze all device values and store receipt timing without synchronization claims",async()=>{
  const f=fixture(), c=f.capture(); c.weightKg=1; c.cameras.front.value="FORGED";
  f.devices.scale.value=45340.4; f.devices.scale.at=100000;
  await f.save(c.id);
  const body=f.calls[0]; assert.equal(body.gross_weight,45340); assert.equal(body.vehicle_plate_number,"T578DZE"); assert.equal(body.custom_fields.trailer_no,"T816EQL"); assert.equal(body.custom_fields.container_no,"CAIU9720214");
  assert.equal(body.capture_workflow.mode,"standard"); assert.equal(body.capture_workflow.weightReceivedAt,99900); assert.equal(body.capture_evidence,undefined);
  await f.save(c.id); assert.equal(f.calls.length,1);
});
test("capture rejects absent, stale, future, ambiguous devices, missing confirmation and unavailable strict mode",()=>{
  for(const change of [f=>f.devices.scale.connected=false,f=>f.devices.scale.at=95000,f=>f.devices.scale.at=100001,f=>f.devices.scale.stable=false,f=>f.devices.cameras.rear.conflict=true,f=>f.devices.cameras.container.at=1,f=>f.devices.cameras.front.value=""]) {
    const f=fixture(); change(f); assert.throws(f.capture);
  }
  const f=fixture(); assert.throws(()=>f.tx.capture({owner:"op",confirmed:false})); assert.throws(()=>f.tx.capture({owner:"op",confirmed:true,mode:"synchronized"}),/not enabled/);
});
test("save rejects missing capture, invalidation, changed weight, changed plates, expiration and wrong ID",async()=>{
  for(const change of [f=>f.tx.invalidate(),f=>f.devices.scale.value=20000,f=>f.devices.cameras.rear.value="OTHER",f=>f.time+=31000]) {
    const f=fixture(), c=f.capture(); change(f); await assert.rejects(f.save(c.id)); assert.equal(f.calls.length,0);
  }
  const f=fixture(); await assert.rejects(f.save("missing")); const c=f.capture(); await assert.rejects(f.save("other")); assert.equal(f.calls.length,0); await f.save(c.id);
});
test("required manual fields are validated without consuming the capture",async()=>{
  const f=fixture(), c=f.capture(); const r=await f.save(c.id,{}); assert.ok(r.validationErrors.driverName); assert.equal(f.journal,null); await f.save(c.id);
});
test("uncertain saves survive restart and resend exact original request, without requiring devices",async()=>{
  const f=fixture(), c=f.capture(); f.send=()=>{throw new Error("network dropped")}; await assert.rejects(f.save(c.id));
  const original=structuredClone(f.calls[0]); assert.equal(f.journal.status,"pending"); f.tx=f.make(); f.devices.scale.connected=false;
  assert.equal(f.tx.status("op").status,"retry"); assert.throws(f.capture,/pending save/);
  await assert.rejects(f.tx.save({id:c.id,owner:"different"}),/same operator/);
  f.send=null; await f.save(c.id,{driverName:"Changed"}); assert.deepEqual(f.calls[1],original); assert.equal(f.journal.status,"complete");
});
test("concurrent saves are rejected and uncertain outcomes cannot be silently discarded",async()=>{
  const f=fixture(), c=f.capture(); let resolve; f.send=()=>new Promise(r=>{resolve=r}); const sending=f.save(c.id);
  await assert.rejects(f.save(c.id),/in progress/); assert.throws(f.capture,/in progress/); resolve({record:{id:1}}); await sending;
});
test("initial validation rejection releases journal; validation rejection on an uncertain retry keeps it",async()=>{
  const f=fixture(), c=f.capture(); f.send=()=>{throw Object.assign(new Error("invalid"),{definitiveRejection:true})}; await assert.rejects(f.save(c.id)); assert.equal(f.journal,null);
  const next=f.capture(); f.send=()=>{throw Error("network")}; await assert.rejects(f.save(next.id)); f.send=()=>{throw Object.assign(Error("invalid"),{definitiveRejection:true})}; await assert.rejects(f.save(next.id)); assert.equal(f.journal.status,"pending");
});
