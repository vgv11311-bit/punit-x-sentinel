"use strict";

// The multipart disposition and plate were observed on the client PC. The XML
// fixture reconstructs the visible fields; it is not the original transcript.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const xmlTemplate = fs.readFileSync(path.join(__dirname,"fixtures/hikvision-observed-event.xml"),"utf8").replace(/^\uFEFF/,"");

function createHikvisionSimulator() {
  let sequence = 0;
  let plate = "MC494S";
  let failure = "";
  let manualMode = "response";
  let staleStreamPlate = "";
  const streams = new Set();
  const server = http.createServer((req,res) => {
    if (failure === "disconnect") return req.socket.destroy();
    if (req.url === "/ISAPI/System/time") return res.end(`<Time><localTime>${new Date().toISOString()}</localTime></Time>`);
    if (req.url === "/ISAPI/Event/notification/alertStream") {
      res.writeHead(200,{"Content-Type":"multipart/mixed; boundary=camera-boundary"});
      res.flushHeaders();
      streams.add(res);
      res.on("close",()=>streams.delete(res));
      return;
    }
    if (req.url === "/ISAPI/Traffic/MNPR/channels/1?laneNo=1&OSD=1") {
      res.end("<ResponseStatus/>");
      const event = makeEvent(plate);
      if (staleStreamPlate) {
        const stale = makeEvent(staleStreamPlate,new Date(Date.now()-60000));
        for (const stream of streams) stream.write(`--camera-boundary\r\nContent-Type: application/xml\r\n\r\n${stale.xml}\r\n--camera-boundary\r\n`);
      }
      for (const stream of streams) stream.write(`--camera-boundary\r\nContent-Type: application/xml\r\n\r\n${event.xml}\r\n--camera-boundary\r\n`);
      return;
    }
    if (req.url === "/ISAPI/Traffic/channels/1/vehicleDetect/manualTrigger") {
      if (manualMode === "stream") { res.writeHead(404); return res.end(); }
      const event = makeEvent(plate);
      return res.end(`<VehicleDetectManualTrigger><captureTime>${event.time}</captureTime><imageName>${event.id}</imageName><ANPRList><ANPR><licensePlate>${plate}</licensePlate></ANPR></ANPRList></VehicleDetectManualTrigger>`);
    }
    res.writeHead(404); res.end();
  });
  function makeEvent(value, date = new Date()) {
    const time = date.toISOString(), id = "sim-" + (++sequence);
    return {id,time,xml:xmlTemplate.replace("MC494S",value).replace("2026-11-18T15:50:01+05:30",time).replace("simulated-event-id",id)};
  }
  async function push(port,event) {
    const body = `--boundary\r\nContent-Disposition: form-data; name="anpr.xml"; filename="anpr.xml"\r\nContent-Type: application/xml\r\n\r\n${event.xml}\r\n--boundary--\r\n`;
    return new Promise((resolve,reject) => {
      const req=http.request({host:"127.0.0.1",port,path:"/anpr",method:"POST",headers:{"content-type":"multipart/form-data; boundary=boundary"}},res=>{res.resume();res.on("end",()=>resolve(res.statusCode));});
      req.on("error",reject);req.end(body);
    });
  }
  return {
    server, makeEvent, push,
    setPlate(value) { plate=value; },
    setFailure(value) { failure=value; },
    setManualMode(value) { manualMode=value; },
    setStaleStreamPlate(value) { staleStreamPlate=value; },
    async start() { await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve)); return server.address().port; },
    async close() { for(const stream of streams) stream.destroy(); await new Promise(resolve=>server.close(resolve)); }
  };
}
module.exports={createHikvisionSimulator};

if (require.main === module) {
  const simulator = createHikvisionSimulator();
  simulator.start().then(port => {
    console.log("Hikvision simulator ready at 127.0.0.1:" + port);
    console.log("Test-only simulator. It sends synthetic plate data.");
    process.on("SIGINT", () => simulator.close().then(() => process.exit(0)));
  }).catch(error => { console.error(error.message); process.exitCode=1; });
}
