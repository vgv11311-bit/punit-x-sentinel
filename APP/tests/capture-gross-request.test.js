"use strict";
const test=require("node:test");const assert=require("node:assert/strict");
const {buildCapturedGrossRequest}=require("../src/capture-gross-request");
const defs=[{key:"vehiclePlate",label:"Vehicle Plate",serverKey:"quality_check",serverId:1,required:true},{key:"trailer_no",serverKey:"trailer_no",serverId:2,required:true},{key:"container_no",serverKey:"container_no",serverId:3,required:true},{key:"driverName",serverKey:"driver",serverId:4,required:true}];
const accepted={requestId:"capture-1",evidence:{id:"capture-1",weightKg:45340,weightAt:1763028000000,weightUncertaintyMs:1,maxSkewMs:1000,cameras:{front:{eventId:"f",value:"T578DZE",capturedAt:1763028000100,timestampResolutionMs:1,clockUncertaintyMs:1},rear:{eventId:"r",value:"T816EQL",capturedAt:1763028000100,timestampResolutionMs:1,clockUncertaintyMs:1},container:{eventId:"c",value:"CAIU9720214",capturedAt:1763028000100,timestampResolutionMs:1,clockUncertaintyMs:1}}}};
test("gross request uses the captured evidence even when form values differ",()=>{
 const req=buildCapturedGrossRequest({accepted,fields:{vehiclePlate:"WRONG",trailer_no:"WRONG",container_no:"WRONG",driverName:"Driver",material:"Ore"},definitions:defs,device:"COM3"});
 assert.equal(req.vehicle_plate_number,"T578DZE");assert.equal(req.custom_fields.quality_check,"T578DZE");assert.equal(req.custom_fields.trailer_no,"T816EQL");assert.equal(req.custom_fields.container_no,"CAIU9720214");assert.equal(req.gross_weight,45340);assert.equal(req.request_id,"capture-1");assert.equal(req.gross_captured_at,new Date(accepted.evidence.weightAt).toISOString());assert.deepEqual(req.capture_evidence,accepted.evidence);
});
test("gross request stops when required form data or camera fields are missing",()=>{
 assert.ok(buildCapturedGrossRequest({accepted,fields:{},definitions:defs}).validationErrors.driverName);
 assert.throws(()=>buildCapturedGrossRequest({accepted,fields:{driverName:"Driver"},definitions:defs.filter(d=>d.key!=="container_no")}),/not configured/);
 assert.throws(()=>buildCapturedGrossRequest({accepted:{...accepted,requestId:"other"},fields:{},definitions:defs}),/valid capture/);
});
