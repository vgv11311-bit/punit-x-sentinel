"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

test("scale configuration requires a password before attempting to save", async () => {
  const html = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  const dom = new JSDOM(html, {runScripts:"outside-only",url:"http://localhost/"});
  const w = dom.window; const calls = [];
  const state = {auth:{authenticated:true,email:"operator@example.test"},currentUser:{name:"Operator",role:"operator"},config:{weightUnit:"KG",fields:[]},settings:{apiBaseUrl:"https://example.test",serial:{path:"COM2",baudRate:9600,dataBits:8,parity:"none",stopBits:1,lineEnding:"\\r\\n"}},records:[]};
  w.sentinel = {getVersion:async()=>"test",getState:async()=>state,getTheme:async()=>null,onCameraStatus:()=>{},onScaleReading:()=>{},cameraState:async()=>({plate:"",listening:false}),refreshFields:async()=>({changed:false}),listPorts:async()=>[{path:"COM2"}],updateSettings:async (changes,password)=>{calls.push({changes,password});return state}};
  try {
    w.eval(source + "\nwindow.__setView = setView;");
    await new Promise(resolve=>setTimeout(resolve,20)); w.__setView("settings");
    await new Promise(resolve=>setTimeout(resolve,10));
    w.document.querySelector('[data-action="save-serial-settings"]').click();
    await new Promise(resolve=>setTimeout(resolve,10)); assert.equal(calls.length,0);
    w.document.getElementById("scaleSettingsPassword").value="example-password";
    w.document.querySelector('[data-action="save-serial-settings"]').click();
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(calls.length,1); assert.equal(calls[0].password,"example-password"); assert.equal(calls[0].changes.serial.path,"COM2");
  } finally { w.close(); }
});

test('disabled account hides the desktop data on the next access check', async () => {
  const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
  const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://localhost/'});const w=dom.window;
  const state={auth:{authenticated:true,email:'a@example.test'},currentUser:{name:'A',role:'administrator'},config:{weightUnit:'KG',fields:[]},settings:{serial:{path:'COM1'}},records:[]};
  const denied={...state,auth:{authenticated:false,email:'',error:'Account is disabled'}};
  w.sentinel={getVersion:async()=>'test',getState:async()=>state,getTheme:async()=>null,onCameraStatus:()=>{},onScaleReading:()=>{},cameraState:async()=>({plate:'',listening:false}),refreshFields:async()=>({accessDenied:true,state:denied})};
  try { w.eval(source+'\nwindow.__poll=refreshFieldsAutomatically;');await new Promise(r=>setTimeout(r,20));await w.__poll();assert.ok(w.document.querySelector('#loginForm'));assert.equal(w.document.querySelector('#completedRows'),null); } finally { w.close(); }
});

test("two gross entries receive distinct capture IDs and completed report asks for password", async () => {
  const html = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  const dom = new JSDOM(html, {runScripts:"outside-only", url:"http://localhost/"});
  const w = dom.window; const calls = []; let downloads = [];
  const record = {id:"remote-1",serverId:1,weighmentNumber:"WB-1",status:"COMPLETED",fields:{vehiclePlate:"T1",driverName:"Driver",material:"Ore"},gross:{weight:100,source:"Live"},tare:{weight:50,source:"Live"},netWeight:50,createdAt:"2026-11-13T00:00:00Z"};
  const state = { auth:{authenticated:true,email:"operator@example.test"}, currentUser:{name:"Operator",role:"operator"}, config:{weightUnit:"KG",fields:[{key:"vehiclePlate",label:"Vehicle Plate",type:"text",required:true,active:true,order:1}]}, settings:{apiBaseUrl:"https://example.test",serial:{path:"COM1"}}, records:[record] };
  w.sentinel = {getVersion:async()=>"test",getState:async()=>state,getTheme:async()=>null,onCameraStatus:()=>{},onScaleReading:()=>{},cameraState:async()=>({plate:"",listening:false}),refreshFields:async()=>({changed:false}),saveGross:async payload=>{calls.push(payload);return {state,record}},downloadReport:async id=>{downloads.push(id);return "Downloads/report.pdf"},listPorts:async()=>[]};
  try {
    w.eval(source + "\nwindow.__state = appState; window.__setView = setView; window.__saveGross = saveGross;");
    await new Promise(resolve => setTimeout(resolve, 20));
    const app = w.__state;
    for (let i=0; i<2; i++) {
      app.gross.captured = 100; app.capture = {status:"captured",snapshot:{id:w.crypto.randomUUID(),weightKg:100,cameras:{front:{value:"T1"},rear:{value:"T2"},container:{value:"CAIU9720214"}}}}; app.camera = {plate:"T1",rear:{value:"T2"},container:{value:"CAIU9720214"}};
      w.__setView("gross");
      await w.__saveGross();
    }
    assert.equal(calls.length, 2); assert.notEqual(calls[0].captureId, calls[1].captureId);
    w.__setView("completed");
    const button = w.document.querySelector('[data-report-id="remote-1"]');
    assert.ok(button);
    const dialog=w.document.getElementById('reportDialog'); dialog.showModal=()=>{dialog.open=true}; dialog.close=()=>{dialog.open=false};
    button.click(); assert.equal(dialog.open,true); assert.deepEqual(downloads, []);
    w.document.getElementById('reportPassword').value='test-password';
    w.document.getElementById('reportForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await new Promise(resolve=>setTimeout(resolve,20)); assert.deepEqual(downloads,['1']); assert.equal(dialog.open,false);
  } finally { w.close(); }
});

test("gross fields stay read-only and weight clears when scale disconnects", async () => {
  const html = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "../src/app.js"), "utf8");
  const dom = new JSDOM(html, {runScripts:"outside-only", url:"http://localhost/"});
  const w = dom.window; let scaleHandler; let cameraHandler;
  const fields = ["vehiclePlate", "trailer_no", "container_no"].map((key,i)=>({key,label:key,type:"text",active:true,order:i,required:true}));
  const state = {auth:{authenticated:true,email:"operator@example.test"},currentUser:{name:"Operator",role:"operator"},config:{weightUnit:"KG",fields},settings:{apiBaseUrl:"https://example.test",serial:{path:"COM1"}},records:[]};
  w.sentinel = {getVersion:async()=>"test",getState:async()=>state,getTheme:async()=>null,onCameraStatus:f=>{cameraHandler=f},onScaleReading:f=>{scaleHandler=f},cameraState:async()=>({plate:"",listening:false}),refreshFields:async()=>({changed:false}),listPorts:async()=>[]};
  try {
    w.eval(source + "\nwindow.__state = appState; window.__setView = setView;");
    await new Promise(resolve => setTimeout(resolve, 20)); w.__setView("gross");
    assert.doesNotMatch(w.document.querySelector('#content').textContent, /one.second|timing unverified/i);
    assert.equal(w.document.querySelector('.weigh-panel .card-header .badge').textContent, 'NOT CONNECTED');
    for (const key of ["vehiclePlate","trailer_no","container_no"]) assert.equal(w.document.getElementById(`field-${key}`).readOnly, true);
    assert.equal(w.document.querySelector('[data-action="save-gross"]').disabled, true);
    assert.match(w.document.querySelector('.scale-value').textContent, /—/);
    w.__state.gross.connected = true;
    cameraHandler({plate:"T578DZE",listening:true,rear:{value:""},container:{value:""}});
    assert.equal(w.document.getElementById('field-vehiclePlate').value, 'T578DZE');
    assert.equal(w.document.getElementById('field-trailer_no').value, '');
    assert.equal(w.document.getElementById('field-container_no').value, '');
    assert.equal(w.document.querySelector('[data-action="save-gross"]').disabled, true);
    cameraHandler({plate:"T578DZE",listening:true,rear:{value:"T816EQL"},container:{value:"CAIU9720214"}});
    scaleHandler({value:45340,stable:true,mode:"serial",receivedAt:new Date().toISOString()});
    assert.equal(w.document.querySelector('[data-action="save-gross"]').disabled, true);
    assert.ok(w.document.querySelector('[data-action="capture-gross"]'));
    assert.equal(w.document.getElementById('field-trailer_no').value, 'T816EQL');
    scaleHandler({disconnected:true});
    assert.equal(w.document.querySelector('.weigh-panel .card-header .badge').textContent, 'NOT CONNECTED');
    assert.equal(w.document.querySelector('[data-action="save-gross"]').disabled, true);
    assert.match(w.document.querySelector('.scale-value').textContent, /—/);
  } finally { w.close(); }
});


test("Capture button requires confirmation and Save uses its ID while later camera updates cannot change the snapshot", async () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname,"../src/index.html"),"utf8"),{runScripts:"outside-only",url:"http://localhost/"});
  const w=dom.window, calls=[]; let cameraHandler;
  const fields=["vehiclePlate","trailer_no","container_no"].map((key,i)=>({key,label:key,type:"text",active:true,order:i}));
  const state={auth:{authenticated:true,email:"op"},currentUser:{name:"Op"},config:{weightUnit:"KG",fields},settings:{serial:{path:"COM3"}},records:[]};
  const snapshot={id:"captured-id",weightKg:45340,cameras:{front:{value:"FRONT"},rear:{value:"REAR"},container:{value:"CAIU9720214"}}};
  w.sentinel={getVersion:async()=>"test",getState:async()=>state,getTheme:async()=>null,onScaleReading:()=>{},onCameraStatus:fn=>cameraHandler=fn,cameraState:async()=>({}),refreshFields:async()=>({changed:false}),captureGross:async options=>{calls.push(options);return snapshot},saveGross:async body=>{calls.push(body);throw Error("offline")}};
  try {
    w.eval(fs.readFileSync(path.join(__dirname,"../src/app.js"),"utf8")+"\nwindow.__setView=setView;");
    await new Promise(r=>setTimeout(r,20)); w.__setView("gross");
    w.document.querySelector('[data-action="capture-gross"]').click(); await new Promise(r=>setTimeout(r,10)); assert.equal(calls.length,0);
    w.document.getElementById("confirmTruck").checked=true;
    w.document.querySelector('[data-action="capture-gross"]').click(); await new Promise(r=>setTimeout(r,20));
    cameraHandler({plate:"DIFFERENT",rear:{value:"NEW"},container:{value:"OTHER"}});
    assert.equal(w.document.getElementById("field-vehiclePlate").value,"FRONT");
    assert.equal(w.document.getElementById("field-trailer_no").value,"REAR");
    w.document.querySelector('[data-action="save-gross"]').click(); await new Promise(r=>setTimeout(r,20));
    assert.equal(calls[1].captureId,"captured-id"); assert.equal(calls[1].weight,undefined);
  } finally { w.close(); }
});

test("camera settings request a direct plate for the selected role and clear the password", async () => {
  const html=fs.readFileSync(path.join(__dirname,"../src/index.html"),"utf8");
  const dom=new JSDOM(html,{runScripts:"outside-only",url:"http://localhost/"});
  const w=dom.window, calls=[];
  const state={auth:{authenticated:true,email:"op@example.test"},currentUser:{name:"Operator",role:"operator"},config:{weightUnit:"KG",fields:[]},settings:{serial:{path:"COM1"},cameras:{rear:{ip:"192.168.1.65"}}},records:[]};
  const camera={listening:false,plate:"",rear:{listening:true,value:"T816EQL"}};
  w.sentinel={getVersion:async()=>"test",getState:async()=>state,getTheme:async()=>null,listPorts:async()=>[],onCameraStatus:()=>{},onScaleReading:()=>{},cameraState:async()=>camera,refreshFields:async()=>({changed:false}),verifyPlate:async args=>{calls.push(args);return camera;}};
  try {
    w.eval(fs.readFileSync(path.join(__dirname,"../src/app.js"),"utf8")+"\nwindow.__view=setView;");
    await new Promise(resolve=>setTimeout(resolve,20));
    w.__view("settings");
    w.document.getElementById("rearCameraUser").value="op";
    w.document.getElementById("rearCameraPassword").value="example";
    w.document.querySelector('[data-action="verify-plate"][data-role="rear"]').click();
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.deepEqual({...calls[0]},{role:"rear",ip:"192.168.1.65",httpPort:80,username:"op",password:"example"});
    assert.equal(w.document.getElementById("rearCameraPassword").value,"");
    assert.match(w.document.getElementById("rearCameraStatus").textContent,/T816EQL/);
  } finally { w.close(); }
});

for (const role of ["front","rear"]) {
  test("Gross Capture reads only the connected "+role+" plate without scale or truck confirmation", async () => {
    const dom=new JSDOM(fs.readFileSync(path.join(__dirname,"../src/index.html"),"utf8"),{runScripts:"outside-only",url:"http://localhost/"});
    const w=dom.window;
    const fields=["vehiclePlate","trailer_no","container_no"].map(key=>({key,label:key,type:"text",active:true}));
    const data={auth:{authenticated:true,email:"op"},currentUser:{name:"Operator"},config:{weightUnit:"KG",fields},settings:{serial:{}},records:[]};
    const camera={plate:"",listening:role==="front",front:{},rear:{},container:{}};
    camera[role]={ip:"192.168.1.64",listening:true,directReady:true,value:""};
    let calls=0,full=0,releaseSecond;
    w.sentinel={getVersion:async()=>"test",getState:async()=>data,getTheme:async()=>null,onScaleReading:()=>{},onCameraStatus:()=>{},cameraState:async()=>camera,refreshFields:async()=>({changed:false}),captureGross:async()=>{full++;}, verifyPlate:async options=>{
      assert.equal(options.role,role);
      calls++;
      assert.equal(options.afterTap,true);
      if(calls===2) await new Promise(resolve=>{releaseSecond=resolve;});
      if(calls===3) throw Error("Camera timed out");
      camera[role].verifiedId="tap-"+calls;
      camera[role].value=calls===1 ? "TRUCK-A" : "TRUCK-B";
      if(role==="front")camera.plate=camera[role].value;
      return camera;
    }};
    try {
      w.eval(fs.readFileSync(path.join(__dirname,"../src/app.js"),"utf8")+"\nwindow.showGross=()=>setView('gross');window.cameraUpdate=updateCameraStatus;");
      await new Promise(r=>setTimeout(r,20)); w.showGross(); w.cameraUpdate(camera);
      const button=w.document.querySelector('[data-action="capture-gross"]');
      assert.equal(button.textContent,"Capture number plate");
      button.click();await new Promise(r=>setTimeout(r,20));
      assert.equal(calls,1);assert.equal(full,0);
      const field=w.document.getElementById(role==="front"?"field-vehiclePlate":"field-trailer_no");
      assert.equal(field.value,"TRUCK-A"); assert.equal(field.readOnly,true);
      assert.equal(w.document.querySelector('[data-action="save-gross"]').disabled,true);
      button.click();
      assert.equal(field.value,"");
      await new Promise(r=>setTimeout(r,10));
      w.cameraUpdate(camera); // An old poll/event arrives while B is being requested.
      assert.equal(field.value,"");
      releaseSecond();
      await new Promise(r=>setTimeout(r,10));
      assert.equal(field.value,"TRUCK-B");
      button.click();
      await new Promise(r=>setTimeout(r,10));
      w.cameraUpdate(camera);
      assert.equal(field.value,"");
      assert.equal(calls,3);assert.equal(full,0);
      assert.equal(w.document.querySelector('[data-action="save-gross"]').disabled,true);
    } finally {w.close();}
  });
}

test("cancelled camera login cannot reuse an already available front plate", async () => {
  const dom=new JSDOM(fs.readFileSync(path.join(__dirname,"../src/index.html"),"utf8"),{runScripts:"outside-only",url:"http://localhost/"});
  const w=dom.window;
  const data={auth:{authenticated:true,email:"operator"},currentUser:{name:"Operator"},config:{weightUnit:"KG",fields:[{key:"vehiclePlate",label:"Vehicle plate",active:true}]},settings:{serial:{}},records:[]};
  const camera={plate:"TRUCK-A",listening:true,front:{ip:"192.168.1.64",listening:true,directReady:false,value:"TRUCK-A"},rear:{},container:{}};
  let verificationCalls=0;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event("close"));};
  w.sentinel={getVersion:async()=>"test",getState:async()=>data,getTheme:async()=>null,onScaleReading:()=>{},onCameraStatus:()=>{},cameraState:async()=>camera,refreshFields:async()=>({changed:false}),verifyPlate:async()=>{verificationCalls++;}};
  try {
    w.eval(fs.readFileSync(path.join(__dirname,"../src/app.js"),"utf8")+"\nwindow.prepare=()=>{setView('gross');updateCameraStatus("+JSON.stringify(camera)+");};");
    await new Promise(r=>setTimeout(r,20));w.prepare();
    const field=w.document.querySelector("[data-camera-plate]");
    assert.equal(field.value,"");
    w.document.querySelector('[data-action="capture-gross"]').click();
    await new Promise(r=>setTimeout(r,10));
    const dialog=w.document.querySelector("dialog");
    assert.ok(dialog.open);assert.equal(field.value,"");
    dialog.querySelector('[type="button"]').click();
    await new Promise(r=>setTimeout(r,10));assert.equal(field.value,"");assert.equal(verificationCalls,0);
  } finally {w.close();}
});
