"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const http=require("node:http");
const {parseManualCapture,triggerManualPlate,MANUAL_PATH}=require("../src/hikvision-manual");
const xml=(plates,time="2026-11-13T10:00:00.123Z")=>`<VehicleDetectManualTrigger><captureTime>${time}</captureTime><imageName>capture-1.jpg</imageName><ANPRList>${plates.map(p=>`<ANPR><licensePlate>${p}</licensePlate></ANPR>`).join("")}</ANPRList></VehicleDetectManualTrigger>`;
test("manual ANPR results require timestamp, capture ID and exactly one plate",()=>{const x=parseManualCapture(xml(["T578DZE"]));assert.equal(x.value,"T578DZE");assert.equal(x.timestampResolutionMs,1);assert.equal(parseManualCapture(xml(["T578DZE"],"2026-11-13T10:00:00Z")).timestampResolutionMs,1000);assert.throws(()=>parseManualCapture(xml(["T1A","T2B"])),/one identified/);assert.throws(()=>parseManualCapture(xml(["T578DZE"],"2026-11-13T10:00:00")),/timezone/);});
test("manual trigger handles digest challenge with a simulated camera",async()=>{let requests=0;const server=http.createServer((req,res)=>{requests++;assert.equal(req.url,MANUAL_PATH);if(!req.headers.authorization){res.writeHead(401,{"WWW-Authenticate":'Digest realm="cam", nonce="abc", qop="auth"'});return res.end();}res.writeHead(200,{"Content-Type":"application/xml"});res.end(xml(["T578DZE"]));});await new Promise(r=>server.listen(0,"127.0.0.1",r));try{const result=await triggerManualPlate({ip:"127.0.0.1",port:server.address().port,username:"op",password:"secret"});assert.equal(result.value,"T578DZE");assert.equal(requests,2);}finally{await new Promise(r=>server.close(r));}});
test("an aborted manual trigger does not send a camera request",async()=>{let requests=0;const server=http.createServer((_req,res)=>{requests++;res.end();});await new Promise(r=>server.listen(0,"127.0.0.1",r));try{const controller=new AbortController();controller.abort();await assert.rejects(triggerManualPlate({ip:"127.0.0.1",port:server.address().port,username:"op",password:"secret",signal:controller.signal}),/Cannot reach camera/);assert.equal(requests,0);}finally{await new Promise(r=>server.close(r));}});

test("stationary MNPR fallback reads a fragmented alert stream without an incoming push", async () => {
  const {ALERT_PATH,TRIGGER_PATH}=require("../src/hikvision-stream");
  let stream;
  const camera = http.createServer((req,res)=>{
    if (req.url === MANUAL_PATH) {res.writeHead(404);return res.end();}
    if (req.url === ALERT_PATH) {
      stream=res;res.writeHead(200,{"Content-Type":"multipart/mixed; boundary=cam"});res.flushHeaders();return;
    }
    if (req.url !== TRIGGER_PATH) {res.writeHead(404);return res.end();}
    res.end("<ok/>");
    const event='<EventNotificationAlert><eventType>ANPR</eventType><ANPR><licensePlate>MC494S</licensePlate></ANPR><UUID>mnpr-1</UUID><dateTime>2026-11-18T16:00:04.123Z</dateTime></EventNotificationAlert>';
    // A delayed event for A arrives after the click for B.
    const oldEvent=event.replace("MC494S","TRUCK-A").replace("16:00:04","16:00:03").replace("mnpr-1","previous");
    stream.write('--cam\r\nContent-Type: application/xml\r\n\r\n'+oldEvent+'\r\n');
    stream.write('--cam\r\nContent-Type: application/xml\r\n\r\n'+event+'\r\n--c');
    setImmediate(()=>stream.write('am\r\n'));
  });
  await new Promise(resolve=>camera.listen(0,"127.0.0.1",resolve));
  try {
    const result=await triggerManualPlate({ip:"127.0.0.1",port:camera.address().port,username:"op",password:"test",allowStream:true,minimumTime:Date.parse("2026-11-18T16:00:04Z")});
    assert.equal(result.value,"MC494S");assert.equal(result.eventId,"mnpr-1");
  } finally {stream?.destroy();await new Promise(resolve=>camera.close(resolve));}
});

test("manual capture preserves tenths and hundredths timestamp precision", () => {
  assert.equal(parseManualCapture(xml(["T578DZE"], "2026-11-13T10:00:00.1Z")).timestampResolutionMs,100);
  assert.equal(parseManualCapture(xml(["T578DZE"], "2026-11-13T10:00:00.12Z")).timestampResolutionMs,10);
});
