"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createAnprReceiver } = require("../src/anpr");
const { parseScaleLine } = require("../src/logic");

test('XK3190-DS3 frames are collected across chunks and decoded with checksum', () => {
  const { createSerialFramer } = require('../src/serial-framer');
  const input = Buffer.from([2, 43, 48, 48, 49, 54, 52, 48, 48, 49, 56, 3]);
  for (let size = 1; size <= input.length; size++) {
    const frames = [];
    const reader = createSerialFramer({ onLine: frame => frames.push(frame), onOverflow: () => assert.fail('unexpected overflow') });
    const stream = Buffer.concat([input, input]);
    for (let i = 0; i < stream.length; i += size) reader.push(stream.subarray(i, i + size));
    assert.equal(frames.length, 2);
    assert.equal(parseScaleLine(frames[0]).value, 1640);
  }
  assert.equal(parseScaleLine('\x02+00150001F\x03').value, 1500);
  assert.equal(parseScaleLine('\x02+00150001E\x03'), null);
  assert.equal(parseScaleLine('\x02+00150011F\x03'), null);
  assert.equal(parseScaleLine('\x02+00150001F'), null);
  const frame = (payload) => '\x02' + payload + [...payload].reduce((v, c) => v ^ c.charCodeAt(0), 0).toString(16).toUpperCase().padStart(2, '0') + '\x03';
  assert.equal(parseScaleLine(frame('+0000000')).value, 0);
  assert.equal(parseScaleLine(frame('+0123452')).value, 123.45);
  assert.equal(parseScaleLine(frame('-0015000')), null);
  assert.equal(parseScaleLine(frame('+0015005')), null);
});

test("TCG ANPR event extracts only plate text from a multipart request", async () => {
  let received;
  const server = createAnprReceiver({ cameraIp: "127.0.0.1", port: 18031, onPlate: (plate) => { received = plate; }, onStatus: () => {} });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const body = '--x\r\nContent-Disposition: form-data; name="image"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n' + 'x'.repeat(140000) + '\r\n--x\r\nContent-Disposition: form-data; name="event"; filename="event.xml"\r\nContent-Type: application/xml\r\n\r\n<EventNotificationAlert><eventType>ANPR</eventType><ANPR><licensePlate>T578DZE</licensePlate></ANPR></EventNotificationAlert>\r\n--x--\r\n';
    const result = await new Promise((resolve, reject) => { const req = http.request({ host:"127.0.0.1", port:server.address().port, path:"/anpr", method:"POST", headers:{"Content-Type":"multipart/form-data; boundary=x"} }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); }); req.on("error", reject); req.write(body.slice(0, 95)); req.end(body.slice(95)); });
    assert.equal(result, 200); assert.equal(received, "T578DZE");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
test("camera metadata requires an unambiguous ANPR plate and accepts structured JSON", () => {
  const {extractPlate} = require("../src/anpr");
  assert.equal(extractPlate(JSON.stringify({eventType:"ANPR",ANPR:{licensePlate:"T846 EGN"}})), "T846 EGN");
  assert.equal(extractPlate(JSON.stringify({eventType:"motion",ANPR:{licensePlate:"T846 EGN"}})), null);
  assert.equal(extractPlate(JSON.stringify({eventType:"ANPR",eventState:"inactive",ANPR:{licensePlate:"T846 EGN"}})), null);
  assert.equal(extractPlate('<EventNotificationAlert><eventType>ANPR</eventType><ANPR><licensePlate>ABC123</licensePlate><licensePlate>XYZ123</licensePlate></ANPR></EventNotificationAlert>'), null);
  assert.equal(extractPlate('<!DOCTYPE x><EventNotificationAlert/>'), null);
});
test("both listeners reject events from the wrong camera and report the problem", async () => {
  const statuses = [], plates = [];
  const server = createAnprReceiver({cameraIp:"127.0.0.2",port:18031,onPlate:p=>plates.push(p),onStatus:()=>{},onActivity:s=>statuses.push(s)});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const code = await new Promise((resolve,reject)=>{
      const request=http.request({host:"127.0.0.1",port:server.address().port,path:"/anpr",method:"POST"},response=>{response.resume();response.on("end",()=>resolve(response.statusCode));});
      request.on("error",reject);request.end("<EventNotificationAlert/>");
    });
    assert.equal(code,403); assert.deepEqual(plates,[]); assert.match(statuses.at(-1),/source IP/i);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
test("rejects unstable and non-kilogram scale messages", () => {
  assert.equal(parseScaleLine("US,GS,28460kg"), null);
  assert.equal(parseScaleLine("ST,GS,28.5tons"), null);
  assert.equal(parseScaleLine("ST,GS,28460kg").unit, "KG");
});
test("serial framing accepts fragmented readings and discards oversized data", () => {
  const { createSerialFramer } = require("../src/serial-framer");
  const readings = []; let overflows = 0;
  const framer = createSerialFramer({ maxLength: 40, onLine: line => readings.push(parseScaleLine(line)?.value), onOverflow: () => overflows++ });
  framer.push(Buffer.from("ST,GS,28"));
  assert.deepEqual(readings, []);
  framer.push(Buffer.from("460kg\r\nST,GS,28460kg\r\n"));
  assert.deepEqual(readings, [28460, 28460]);
  framer.push(Buffer.from("x".repeat(41)));
  assert.equal(overflows, 1);
  framer.push(Buffer.from("ST,GS,123kg\n"));
  assert.deepEqual(readings, [28460, 28460, 123]);
});
test("serial framing honors the indicator's selected line ending across chunks", () => {
  const { createSerialFramer, decodeLineEnding } = require("../src/serial-framer");
  for (const [setting, bytes] of [["\\r\\n", "\r\n"], ["\\r", "\r"], ["\\n", "\n"]]) {
    const lines = [];
    const framer = createSerialFramer({ delimiter: decodeLineEnding(setting), onLine: line => lines.push(line), onOverflow: () => assert.fail("unexpected overflow") });
    framer.push(Buffer.from("ST,GS,123kg" + bytes.slice(0, -1)));
    assert.deepEqual(lines, []);
    framer.push(Buffer.from(bytes.slice(-1)));
    assert.deepEqual(lines, ["ST,GS,123kg"]);
  }
  const lines = [];
  const framer = createSerialFramer({ delimiter: decodeLineEnding("\\r\\n"), onLine: line => lines.push(line), onOverflow: () => {} });
  framer.push(Buffer.from("ST,GS,123kg\n"));
  assert.deepEqual(lines, []);
  assert.throws(() => decodeLineEnding("invalid"), /line ending/);
});
const { isPlateField } = require("../src/logic");
test("a renamed custom vehicle plate field is also camera controlled", () => {
  assert.equal(isPlateField({ key: "quality_check", label: "Vehicle Plate Number" }), true);
  assert.equal(isPlateField({ key: "truck_trailer_plate_no", label: "Truck Trailer Plate No" }), false);
});
test("front and rear listeners retain distinct plate events", async () => {
  const plates = {};
  const servers = ["front", "rear"].map((role) => createAnprReceiver({
    cameraIp: "127.0.0.1", port: role === "front" ? 18031 : 18032,
    onPlate: (plate) => { plates[role] = plate; }, onStatus: () => {}
  }));
  await Promise.all(servers.map((server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))));
  try {
    await Promise.all(servers.map((server, i) => new Promise((resolve, reject) => {
      const req = http.request({host:"127.0.0.1", port:server.address().port, path:"/anpr", method:"POST"}, (res) => { res.resume(); res.on("end", resolve); });
      req.on("error", reject);
      req.end(`<EventNotificationAlert><eventType>ANPR</eventType><ANPR><licensePlate>${i ? "T816EQL" : "T578DZE"}</licensePlate></ANPR></EventNotificationAlert>`);
    })));
    assert.deepEqual(plates, {front:"T578DZE", rear:"T816EQL"});
  } finally { await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))); }
});
test("gross report core fields use server field names", () => {
  const { reportCoreFields } = require("../src/logic");
  assert.deepEqual(reportCoreFields({driverName:" Driver ", material:" Copper Ore "}), {driver_name:"Driver", material:"Copper Ore"});
});
test("required report fields reject whitespace-only input", () => {
  const { validateDynamicFields } = require("../src/logic");
  assert.ok(validateDynamicFields([{key:"agent_name", label:"Agent Name", required:true}], {agent_name:"   "}).agent_name);
});
const { validateTheme } = require('../src/theme');
test('shared palette accepts only six digit color values', () => {
  assert.deepEqual(validateTheme({background:'#ffffff',surface:'#a8c9c8',accent:'#f45b0b'}),{background:'#FFFFFF',surface:'#A8C9C8',accent:'#F45B0B'});
  assert.equal(validateTheme({background:'#fff',surface:'#a8c9c8',accent:'url(https://example.com)'}), null);
});

test("serial library receives fragmented readings from a simulated COM port", async () => {
  const { SerialPortMock } = require("serialport");
  const { createSerialFramer } = require("../src/serial-framer");
  SerialPortMock.binding.createPort("COM_TEST_SENTINEL", {echo:false,record:true});
  const port = new SerialPortMock({path:"COM_TEST_SENTINEL",baudRate:9600});
  const values=[];
  const framer = createSerialFramer({onLine:line=>values.push(parseScaleLine(line)?.value),onOverflow:()=>assert.fail("unexpected overflow")});
  port.on("data", chunk => framer.push(chunk));
  try {
    await new Promise((resolve,reject) => { port.once("open",resolve);port.once("error",reject); });
    port.port.emitData("ST,GS,28");
    port.port.emitData("460kg\r\nST,GS,28460kg\r\n");
    await new Promise(resolve => setTimeout(resolve,50));
    assert.deepEqual(values,[28460,28460]);
  } finally { await new Promise(resolve => port.close(resolve)); SerialPortMock.binding.reset(); }
});

test("listener accepts namespace-prefixed Hikvision plate metadata and explains status-only events", () => {
  const {extractPlate} = require("../src/anpr");
  const xml = '<h:EventNotificationAlert xmlns:h="urn:hikvision"><h:eventType>ANPR</h:eventType><h:ANPR><h:licensePlate>MC494S</h:licensePlate></h:ANPR></h:EventNotificationAlert>';
  assert.equal(extractPlate(xml), "MC494S");
  let reason;
  assert.equal(extractPlate(xml.replace(">ANPR<", ">heartbeat<"), message => { reason = message; }), null);
  assert.match(reason, /non-ANPR/);
});

test("front/rear receiver tolerates a trailing disposition semicolon and ancillary status metadata", async () => {
  const plates = [];
  const server = createAnprReceiver({cameraIp:"127.0.0.1",port:18031,onPlate:value=>plates.push(value),onStatus:()=>{}});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const part = (event, suffix="") => '--cam\r\nContent-Disposition: form-data; name="anpr.xml"; filename="anpr.xml"' + suffix + '\r\nContent-Type: application/xml\r\n\r\n<EventNotificationAlert><eventType>'+event+'</eventType><ANPR><licensePlate>MC494S</licensePlate></ANPR></EventNotificationAlert>\r\n';
  const post = parts => new Promise((resolve,reject)=>{
    const req=http.request({host:"127.0.0.1",port:server.address().port,path:"/anpr",method:"POST",headers:{"content-type":"multipart/form-data; boundary=cam"}},res=>{res.resume();res.on("end",resolve);});
    req.on("error",reject);req.end(parts+"--cam--\r\n");
  });
  try {
    await post(part("ANPR",";"));
    await post(part("heartbeat")+part("ANPR"));
    await post(part("ANPR")+part("ANPR"));
    assert.deepEqual(plates,["MC494S","MC494S"]);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test("a replay or out-of-order event cannot renew a plate", async () => {
  const plates=[];
  const server=createAnprReceiver({cameraIp:"127.0.0.1",port:18031,onPlate:value=>plates.push(value),onStatus:()=>{}});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  async function post(id,seconds,plate) {
    await new Promise((resolve,reject)=>{
      const req=http.request({host:"127.0.0.1",port:server.address().port,path:"/anpr",method:"POST"},res=>{res.resume();res.on("end",resolve);});
      req.on("error",reject);
      req.end(JSON.stringify({UUID:id,dateTime:"2026-11-18T16:00:"+seconds+"Z",eventType:"ANPR",ANPR:{licensePlate:plate}}));
    });
  }
  try {
    await post("a","09","MC494S");
    await post("a","09","MC494S");
    await post("b","08","MC494C");
    await post("c","10","ABC123");
    assert.deepEqual(plates,["MC494S","ABC123"]);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
