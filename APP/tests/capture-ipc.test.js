"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const vm = require("node:vm"), fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const {createRequire} = require("node:module");

test("real main-process IPC captures, saves frozen values, rejects bypass and recovers a failed response", async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"sentinel-ipc-"));
  const main=path.join(__dirname,"../main.js"), originalRequire=createRequire(main), handlers=new Map(), calls=[];
  let failRead=true;
  class Client {
    async createWeighment(body) { calls.push(body); return {data:{id:1}}; }
    async weighment() { if(failRead) throw Error("response lost"); const b=calls[0]; return {data:{id:1,weighment_no:"WB-1",vehicle_plate:b.vehicle_plate_number,gross_weight:b.gross_weight,status:"tare_pending",custom:b.custom_fields}}; }
  }
  const context = vm.createContext({console, Buffer, process, structuredClone, setInterval, clearInterval, setTimeout, __dirname:path.dirname(main),require:name=>{
    if(name==="electron") return {app:{getPath:()=>directory,whenReady:()=>new Promise(()=>{}),on:()=>{},requestSingleInstanceLock:()=>true},ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},safeStorage:{isEncryptionAvailable:()=>false}};
    if(name==="./src/api-client") return {...originalRequire(name),ApiClient:Client};
    return originalRequire(name);
  }});
  try {
    vm.runInContext(fs.readFileSync(main,"utf8"), context);
    vm.runInContext(`
      sessionToken="test"; sessionEmail="operator@example.test";
      const fixture=defaultState(); fixture.settings.serial.path="COM3";
      fixture.config.fields=["vehiclePlate","driverName","material","gate","trailer_no","container_no","container_type","container_size","driver_licence","product_count_desc","customer_client_name","agent_name","transporter","cargo_type"].map((key,index)=>({key,label:key,serverId:index+1,serverKey:key,required:true,active:true,type:"text"}));
      persistState(fixture); serialPort={isOpen:true};
      for(const [i,role] of ["front","rear","container"].entries()) { cameraServers[role]={listening:true}; cameraReadings[role]={value:["T578DZE","T816EQL","CAIU9720214"][i],at:Date.now()}; }
      latestScaleReading={mode:"serial",stable:true,value:45340,receivedAt:new Date().toISOString()}; registerHandlers();
    `,context);
    assert.equal(handlers.has("app:download-report"), false);
    const capture=await handlers.get("capture:gross")(null,{confirmed:true,mode:"standard"});
    const fields=Object.fromEntries(["driverName","material","gate","container_type","container_size","driver_licence","product_count_desc","customer_client_name","agent_name","transporter","cargo_type"].map(key=>[key,"Sample"]));
    await assert.rejects(handlers.get("app:save-gross")(null,{captureId:"forged",fields}));
    await assert.rejects(handlers.get("app:save-gross")(null,{captureId:capture.id,fields,weight:1}),/response lost/);
    assert.equal(calls[0].gross_weight,45340); assert.equal(calls[0].vehicle_plate_number,"T578DZE");
    assert.equal(handlers.get("capture:status")().status,"retry");
    vm.runInContext('serialPort=null; latestScaleReading=null;',context);
    failRead=false;
    const result=await handlers.get("app:save-gross")(null,{captureId:capture.id,fields:{driverName:"changed"}});
    assert.equal(result.record.gross.weight,45340); assert.deepEqual(calls[0],calls[1]);
    const stored=JSON.parse(fs.readFileSync(path.join(directory,"gross-save-journal.json"))); assert.equal(stored.status,"complete");
  } finally { for(const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory,name)); fs.rmdirSync(directory); }
});
