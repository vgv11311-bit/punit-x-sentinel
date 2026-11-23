"use strict";

// This is a simulator: its timestamps and clock bounds are deliberately supplied
// by the test and do not prove that any physical device provides those values.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { SerialPortMock } = require("serialport");
const { createWorker } = require("tesseract.js");
const { createSerialFramer } = require("../src/serial-framer");
const { parseScaleLine } = require("../src/logic");
const { triggerManualPlate } = require("../src/hikvision-manual");
const { getSnapshot, extractContainerCodes } = require("../src/container-ocr");
const { coordinateCapture } = require("../src/capture-coordinator");

test("simulated serial, two ISAPI cameras and container OCR form one bounded capture", {timeout: 60000}, async () => {
  const weightAt = Date.parse("2026-11-13T10:00:00.000Z");
  const captureAt = new Date(weightAt + 100).toISOString();
  const jpeg = fs.readFileSync(path.join(__dirname, "fixtures/container-sample.jpg"));
  const servers = ["front", "rear", "container"].map(role => http.createServer((req, res) => {
    if (role === "container") { res.writeHead(200, {"Content-Type":"image/jpeg"}); return res.end(jpeg); }
    assert.equal(req.url, "/ISAPI/Traffic/channels/1/vehicleDetect/manualTrigger");
    res.writeHead(200, {"Content-Type":"application/xml"});
    res.end(`<VehicleDetectManualTrigger><captureTime>${captureAt}</captureTime><imageName>${role}.jpg</imageName><ANPRList><ANPR><licensePlate>${role === "front" ? "T578DZE" : "T816EQL"}</licensePlate></ANPR></ANPRList></VehicleDetectManualTrigger>`);
  }));
  await Promise.all(servers.map(server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve))));
  SerialPortMock.binding.createPort("COM_CAPTURE_TEST", {echo:false, record:true});
  const port = new SerialPortMock({path:"COM_CAPTURE_TEST", baudRate:9600});
  let worker;
  try {
    await new Promise((resolve,reject) => {port.once("open",resolve);port.once("error",reject);});
    const reading = new Promise(resolve => {
      const framer = createSerialFramer({delimiter:"\r\n",onLine:line=>resolve(parseScaleLine(line)),onOverflow:()=>assert.fail("serial overflow")});
      port.on("data",chunk=>framer.push(chunk));
    });
    port.port.emitData("ST,GS,45340kg\r\n");
    const parsed = await reading;
    const language = require("@tesseract.js-data/eng");
    worker = await createWorker("eng", 1, {langPath:language.langPath,gzip:true,cacheMethod:"none",logger:()=>{}});
    await worker.setParameters({tessedit_pageseg_mode:"11",tessedit_char_whitelist:"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"});
    const options = index => ({ip:"127.0.0.1",port:servers[index].address().port,username:"test",password:"test"});
    const event = (role, eventId, value, capturedAt = weightAt + 100) => ({sessionId:"capture-1",role,eventId,value,capturedAt,timestampResolutionMs:1,clockUncertaintyMs:1});
    const cameras = {
      front: async () => {const r=await triggerManualPlate(options(0));return {...r,...event("front",r.eventId,r.value,r.capturedAt)};},
      rear: async () => {const r=await triggerManualPlate(options(1));return {...r,...event("rear",r.eventId,r.value,r.capturedAt)};},
      // The snapshot API does not establish exposure timing. The test alone supplies
      // a synthetic timestamp; the production adapter must never assume this.
      container: async () => {const image=await getSnapshot(options(2));const result=await worker.recognize(image);const codes=extractContainerCodes(result.data.text);assert.deepEqual(codes,["CAIU9720214"]);return event("container","container.jpg",codes[0]);}
    };
    const result = await coordinateCapture({id:"capture-1",readScale:async()=>({connected:true,stable:true,value:parsed.value,sampleAt:weightAt,uncertaintyMs:1,cycleId:"vehicle-1"}),cameras,now:()=>weightAt+500,maxSkewMs:1000,deadlineMs:weightAt+30000,maxWeightAgeMs:1000,maxWeightDeltaKg:0.5});
    assert.equal(result.weightKg,45340);
    assert.deepEqual(Object.fromEntries(Object.entries(result.cameras).map(([role,item])=>[role,item.value])),{front:"T578DZE",rear:"T816EQL",container:"CAIU9720214"});
  } finally {
    if (worker) await worker.terminate();
    if (port.isOpen) await new Promise(resolve=>port.close(resolve));
    SerialPortMock.binding.reset();
    await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));
  }
});
