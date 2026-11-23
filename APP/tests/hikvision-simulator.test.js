"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm"), fs = require("node:fs"), os = require("node:os"), path = require("node:path"), http = require("node:http");
const {createRequire} = require("node:module");
const {createHikvisionSimulator} = require("./hikvision-simulator");

test("Hikvision simulator exercises front and rear, two trucks, stale upload and camera failure", async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"sentinel-simulator-"));
  const main=path.join(__dirname,"../main.js"), original=createRequire(main), handlers=new Map();
  const context=vm.createContext({console,Buffer,process,structuredClone,setInterval,clearInterval,setTimeout,__dirname:path.dirname(main),require:name=>{
    if(name==="electron") return {app:{getPath:()=>directory,whenReady:()=>new Promise(()=>{}),on:()=>{},requestSingleInstanceLock:()=>true},ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},safeStorage:{isEncryptionAvailable:()=>false}};
    return original(name);
  }});
  const sim=createHikvisionSimulator();
  const cameraPort=await sim.start();
  try {
    vm.runInContext(fs.readFileSync(main,"utf8"),context);
    vm.runInContext("sessionToken='test';sessionEmail='operator@example.test';persistState(defaultState());registerHandlers()",context);
    for(const role of ["front","rear"]) {
      const probe=http.createServer();await new Promise(r=>probe.listen(0,"127.0.0.1",r));const listenerPort=probe.address().port;await new Promise(r=>probe.close(r));
      await handlers.get("camera:connect")(null,{role,ip:"127.0.0.1",port:listenerPort});
      const first=sim.makeEvent("MC494S",new Date(Date.now()-10000));
      assert.equal(await sim.push(listenerPort,first),200);
      assert.equal(handlers.get("camera:state")()[role].value,"MC494S");
      sim.setPlate("TRUCKA123");
      const verify=()=>handlers.get("camera:verify-plate")(null,{role,ip:"127.0.0.1",username:"test",password:"test",httpPort:cameraPort,afterTap:true});
      assert.equal((await verify())[role].value,"TRUCKA123");
      sim.setPlate("TRUCKB456");
      assert.equal((await verify())[role].value,"TRUCKB456");
      await sim.push(listenerPort,first);
      assert.equal(handlers.get("camera:state")()[role].value,"TRUCKB456");
      sim.setFailure("disconnect");
      await assert.rejects(verify());
      assert.equal(handlers.get("camera:state")()[role].value,"");
      sim.setFailure("");
      assert.equal((await verify())[role].value,"TRUCKB456");
      await handlers.get("camera:disconnect")(null,role);
    }
  } finally {
    for(const role of ["front","rear"]) await handlers.get("camera:disconnect")(null,role);
    await sim.close();
    for(const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory,file));
    fs.rmdirSync(directory);
  }
});

test("Hikvision simulator tests triggered alert stream and rejects delayed prior plate", async () => {
  const sim=createHikvisionSimulator();
  const {triggerManualPlate}=require("../src/hikvision-manual");
  const port=await sim.start();
  try {
    sim.setManualMode("stream");
    sim.setStaleStreamPlate("TRUCKA123");
    sim.setPlate("TRUCKB456");
    const result=await triggerManualPlate({ip:"127.0.0.1",port,username:"test",password:"test",allowStream:true,minimumTime:Date.now()-1000});
    assert.equal(result.value,"TRUCKB456");
    sim.setFailure("disconnect");
    await assert.rejects(triggerManualPlate({ip:"127.0.0.1",port,username:"test",password:"test",allowStream:true}));
  } finally {await sim.close();}
});

test("conflicting Hikvision reads block the plate and a fresh matching retry recovers", async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"sentinel-conflict-"));
  const main=path.join(__dirname,"../main.js"), original=createRequire(main), handlers=new Map();
  const context=vm.createContext({console,Buffer,process,structuredClone,setInterval,clearInterval,setTimeout,__dirname:path.dirname(main),require:name=>{
    if(name==="electron") return {app:{getPath:()=>directory,whenReady:()=>new Promise(()=>{}),on:()=>{},requestSingleInstanceLock:()=>true},ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},safeStorage:{isEncryptionAvailable:()=>false}};
    return original(name);
  }});
  const sim=createHikvisionSimulator(), cameraPort=await sim.start();
  const probe=http.createServer();await new Promise(r=>probe.listen(0,"127.0.0.1",r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  try {
    vm.runInContext(fs.readFileSync(main,"utf8"),context);
    vm.runInContext("sessionToken='test';sessionEmail='operator@example.test';persistState(defaultState());registerHandlers()",context);
    await handlers.get("camera:connect")(null,{role:"front",ip:"127.0.0.1",port});
    await sim.push(port,sim.makeEvent("MC494S",new Date(Date.now()-1000)));
    await sim.push(port,sim.makeEvent("MC494C"));
    let state=handlers.get("camera:state")();
    assert.equal(state.front.conflict,true);
    assert.equal(state.plate,"");
    assert.match(state.front.conflictMessage,/MC494S.*MC494C/);
    sim.setPlate("MC494C");
    state=await handlers.get("camera:verify-plate")(null,{role:"front",ip:"127.0.0.1",username:"test",password:"test",httpPort:cameraPort,afterTap:true});
    assert.equal(state.front.conflict,false);
    assert.equal(state.plate,"MC494C");
  } finally {
    await handlers.get("camera:disconnect")(null,"front");
    await sim.close();
    for(const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory,file));
    fs.rmdirSync(directory);
  }
});

test("receiver reports wrong path, wrong source and malformed events without filling a plate", async () => {
  const {createAnprReceiver}=require("../src/anpr"), statuses=[],plates=[];
  const receiver=createAnprReceiver({cameraIp:"127.0.0.1",port:18031,onPlate:p=>plates.push(p),onStatus:()=>{},onActivity:s=>statuses.push(s)});
  await new Promise(r=>receiver.listen(0,"127.0.0.1",r));
  const send=(pathname,body)=>new Promise((resolve,reject)=>{
    const req=http.request({host:"127.0.0.1",port:receiver.address().port,path:pathname,method:"POST",headers:{"Content-Type":"application/xml"}},res=>{res.resume();res.on("end",()=>resolve(res.statusCode));});req.on("error",reject);req.end(body);
  });
  try {
    assert.equal(await send("/wrong","<EventNotificationAlert/>"),403);
    assert.equal(await send("/anpr","<EventNotificationAlert><eventType>ANPR</eventType>"),200);
    assert.equal(await send("/anpr","<EventNotificationAlert><eventType>ANPR</eventType><ANPR><licensePlate>UNKNOWN</licensePlate></ANPR></EventNotificationAlert>"),200);
    assert.deepEqual(plates,[]);
    assert.ok(statuses.some(s=>/path/i.test(s)));
    assert.ok(statuses.some(s=>/unsupported|empty|unknown/i.test(s)));
  } finally {await new Promise(r=>receiver.close(r));}
});
