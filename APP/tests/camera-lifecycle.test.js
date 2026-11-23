"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const {createRequire} = require("node:module");
const http = require("node:http");

test("a single front camera event is available without the other cameras or scale", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),"sentinel-front-"));
  const main = path.join(__dirname,"../main.js"), original = createRequire(main), handlers = new Map();
  const probe=http.createServer(); await new Promise(resolve=>probe.listen(0,"127.0.0.1",resolve)); const port=probe.address().port; await new Promise(resolve=>probe.close(resolve));
  const context = vm.createContext({console,Buffer,process,structuredClone,setInterval,clearInterval,setTimeout,__dirname:path.dirname(main),require:name=>{
    if(name === "electron") return {app:{getPath:()=>directory,whenReady:()=>new Promise(()=>{}),on:()=>{},requestSingleInstanceLock:()=>true},ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},safeStorage:{isEncryptionAvailable:()=>false}};
    return original(name);
  }});
  try {
    vm.runInContext(fs.readFileSync(main,"utf8"),context);
    vm.runInContext("sessionToken='test'; sessionEmail='operator@example.test'; persistState(defaultState()); registerHandlers();",context);
    await handlers.get("camera:connect")(null,{role:"front",ip:"127.0.0.1",port});
    const status = await new Promise((resolve,reject)=>{
      const req=http.request({host:"127.0.0.1",port,path:"/anpr",method:"POST",headers:{"content-type":"application/xml"}},res=>{res.resume();res.on("end",()=>resolve(res.statusCode));});
      req.on("error",reject);req.end("<EventNotificationAlert><eventType>ANPR</eventType><ANPR><licensePlate>T846EGN</licensePlate></ANPR></EventNotificationAlert>");
    });
    assert.equal(status,200);
    const state=handlers.get("camera:state")();
    assert.equal(state.plate,"T846EGN");assert.equal(state.rear.listening,false);assert.equal(state.container.listening,false);
    assert.throws(()=>handlers.get("capture:gross")(null,{confirmed:true,mode:"standard"}),/stable RS-232/);
  } finally {
    if(handlers.has("camera:disconnect")) handlers.get("camera:disconnect")(null,"front");
    for(const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory,name)); fs.rmdirSync(directory);
  }
});

test("stopping while container OCR starts cannot reconnect it later", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),"sentinel-camera-"));
  const main = path.join(__dirname,"../main.js"), original = createRequire(main), handlers = new Map();
  let resolveReader, closed = 0;
  const startup = new Promise(resolve => { resolveReader = resolve; });
  const context = vm.createContext({console,Buffer,process,structuredClone,setInterval,clearInterval,setTimeout,__dirname:path.dirname(main),require:name=>{
    if(name === "electron") return {app:{getPath:()=>directory,whenReady:()=>new Promise(()=>{}),on:()=>{},requestSingleInstanceLock:()=>true},ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},safeStorage:{isEncryptionAvailable:()=>false}};
    if(name === "./src/container-ocr") return {createContainerReader:()=>startup};
    return original(name);
  }});
  try {
    vm.runInContext(fs.readFileSync(main,"utf8"),context);
    vm.runInContext("sessionToken='test'; sessionEmail='operator@example.test'; persistState(defaultState()); registerHandlers();",context);
    const connecting = handlers.get("container:connect")(null,{ip:"192.168.1.22",port:80,username:"operator",password:"test"});
    await handlers.get("container:disconnect")();
    resolveReader({listening:true,close:async()=>{closed++;}});
    await assert.rejects(connecting,/cancelled/);
    assert.equal(closed,1);
    assert.equal(handlers.get("camera:state")().container.listening,false);
  } finally { for(const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory,name)); fs.rmdirSync(directory); }
});

test("a blank container view clears the live value and a different code still conflicts", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),"sentinel-container-"));
  const main = path.join(__dirname,"../main.js"), original = createRequire(main), handlers = new Map();
  let callbacks;
  const reader = {listening:true,cameraIp:"192.168.1.22",close:async()=>{}};
  const context = vm.createContext({console,Buffer,process,structuredClone,setInterval,clearInterval,setTimeout,__dirname:path.dirname(main),require:name=>{
    if(name === "electron") return {app:{getPath:()=>directory,whenReady:()=>new Promise(()=>{}),on:()=>{},requestSingleInstanceLock:()=>true},ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},safeStorage:{isEncryptionAvailable:()=>false}};
    if(name === "./src/container-ocr") return {createContainerReader:async (_config, cb)=>{callbacks=cb;return reader;}};
    return original(name);
  }});
  try {
    vm.runInContext(fs.readFileSync(main,"utf8"),context);
    vm.runInContext("sessionToken='test'; sessionEmail='operator@example.test'; persistState(defaultState()); registerHandlers();",context);
    await handlers.get("container:connect")(null,{ip:reader.cameraIp,port:80,username:"operator",password:"test"});
    callbacks.onCode("CAIU9720214",Date.now());
    assert.equal(handlers.get("camera:state")().container.value,"CAIU9720214");
    callbacks.onStatus({connected:true,clearReading:true,status:"Waiting"});
    assert.equal(handlers.get("camera:state")().container.value,"");
    callbacks.onCode("MSCU6639871",Date.now());
    assert.equal(handlers.get("camera:state")().container.conflict,true);
    assert.equal(handlers.get("camera:state")().container.value,"");
    await handlers.get("container:disconnect")();
  } finally { for(const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory,name)); fs.rmdirSync(directory); }
});

test("two direct captures recover missing uploads, expired and conflicting readings on either role", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),"sentinel-verify-"));
  const main = path.join(__dirname,"../main.js");
  const original = createRequire(main), handlers = new Map();
  let sequence = 0;
  let readings = [];
  let baseline = 0, clockValid = true;
  const camera = http.createServer((req,res) => {
    if(req.url === "/ISAPI/System/time") {
      res.end("<Time><localTime>"+(clockValid ? new Date(1700000000000+baseline).toISOString() : "unknown")+"</localTime></Time>");
      return;
    }
    sequence++;
    const plate = readings.shift() || "MC494S";
    res.end(`<VehicleDetectManualTrigger><captureTime>${new Date(1700000000000 + sequence).toISOString()}</captureTime><imageName>${sequence}.jpg</imageName><ANPRList><ANPR><licensePlate>${plate}</licensePlate></ANPR></ANPRList></VehicleDetectManualTrigger>`);
  });
  await new Promise(resolve => camera.listen(0,"127.0.0.1",resolve));
  const context = vm.createContext({console,Buffer,process,structuredClone,setInterval,clearInterval,setTimeout,__dirname:path.dirname(main),require:name=>{
    if(name === "electron") return {app:{getPath:()=>directory,whenReady:()=>new Promise(()=>{}),on:()=>{},requestSingleInstanceLock:()=>true},ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},safeStorage:{isEncryptionAvailable:()=>false}};
    return original(name);
  }});
  try {
    vm.runInContext(fs.readFileSync(main,"utf8"),context);
    vm.runInContext("sessionToken='test'; sessionEmail='operator@example.test'; persistState(defaultState()); registerHandlers();",context);
    for (const role of ["front","rear"]) {
      const probe = http.createServer();
      await new Promise(resolve=>probe.listen(0,"127.0.0.1",resolve));
      const port = probe.address().port;
      await new Promise(resolve=>probe.close(resolve));
      await handlers.get("camera:connect")(null,{role,ip:"127.0.0.1",port});
      const verify = () => handlers.get("camera:verify-plate")(null,{role,ip:"127.0.0.1",username:"op",password:"test",httpPort:camera.address().port});
      const fresh = () => handlers.get("camera:verify-plate")(null,{role,ip:"127.0.0.1",username:"op",password:"test",httpPort:camera.address().port,afterTap:true});
      baseline=sequence;readings=["TRUCK-A","TRUCK-A"];
      const truckA=(await fresh())[role];
      assert.equal(truckA.value,"TRUCK-A");
      baseline=sequence;readings=["TRUCK-B","TRUCK-B"];
      const truckB=(await fresh())[role];
      assert.equal(truckB.value,"TRUCK-B");assert.notEqual(truckB.verifiedId,truckA.verifiedId);
      baseline=sequence+20;readings=["TRUCK-A","TRUCK-A"]; // Delayed older captures with distinct IDs.
      await assert.rejects(fresh(),/older/);
      assert.equal(handlers.get("camera:state")()[role].value,"");
      baseline=sequence+20;readings=["TRUCK-A","TRUCK-A"];
      await assert.rejects(verify(),/older/);
      assert.equal(handlers.get("camera:state")()[role].value,"");
      clockValid=false;
      await assert.rejects(fresh(),/clock/);
      clockValid=true;baseline=sequence;
      assert.equal((await verify())[role].value,"MC494S");
      const state = handlers.get("camera:state")();
      assert.equal(state[role].directReady,true);
      assert.equal(JSON.stringify(state).includes("password"),false);
      const repeat = await handlers.get("camera:verify-plate")(null,{role,ip:"127.0.0.1"});
      assert.equal(repeat[role].value,"MC494S");
      vm.runInContext(`cameraReadings.${role}.at -= 31000`,context);
      const expired = handlers.get("camera:state")()[role];
      assert.equal(expired.value,"");
      assert.match(expired.status,/expired/i);
      readings=["MC494S","MC494C"];
      await assert.rejects(verify(),/disagree/);
      assert.equal(handlers.get("camera:state")()[role].conflict,true);
      assert.equal((await verify())[role].value,"MC494S");
      await handlers.get("camera:disconnect")(null,role);
    }
  } finally {
    for(const role of ["front","rear"]) await handlers.get("camera:disconnect")?.(null,role);
    await new Promise(resolve => camera.close(resolve));
    for(const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory,file));
    fs.rmdirSync(directory);
  }
});

test("stopping a front listener while it is starting does not leave it connected", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),"sentinel-start-stop-"));
  const main = path.join(__dirname,"../main.js"), original = createRequire(main), handlers = new Map();
  const probe=http.createServer();
  await new Promise(resolve=>probe.listen(0,"127.0.0.1",resolve));
  const port=probe.address().port;
  await new Promise(resolve=>probe.close(resolve));
  const context=vm.createContext({console,Buffer,process,structuredClone,setInterval,clearInterval,setTimeout,__dirname:path.dirname(main),require:name=>{
    if(name==="electron") return {app:{getPath:()=>directory,whenReady:()=>new Promise(()=>{}),on:()=>{},requestSingleInstanceLock:()=>true},ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},safeStorage:{isEncryptionAvailable:()=>false}};
    return original(name);
  }});
  try {
    vm.runInContext(fs.readFileSync(main,"utf8"),context);
    vm.runInContext("sessionToken='test'; sessionEmail='op'; persistState(defaultState()); registerHandlers();",context);
    const connecting=handlers.get("camera:connect")(null,{role:"front",ip:"127.0.0.1",port});
    await handlers.get("camera:disconnect")(null,"front");
    await assert.rejects(connecting,/cancelled/);
    assert.equal(handlers.get("camera:state")().front.listening,false);
    const replacement=http.createServer();
    await new Promise((resolve,reject)=>{replacement.once("error",reject);replacement.listen(port,"0.0.0.0",resolve);});
    await new Promise(resolve=>replacement.close(resolve));
  } finally {
    await handlers.get("camera:disconnect")(null,"front");
    for(const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory,file));
    fs.rmdirSync(directory);
  }
});
