"use strict";
const {DOMParser} = require("@xmldom/xmldom");
const http = require("node:http");
const net = require("node:net");
const { digestAuthorization } = require("./container-ocr");
const MANUAL_PATH = "/ISAPI/Traffic/channels/1/vehicleDetect/manualTrigger";

function parseManualCapture(xml) {
  const text = String(xml || "");
  if (Buffer.byteLength(text) > 1024*1024 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("Invalid camera response.");
  let malformed = false;
  const invalid = () => { malformed = true; };
  const doc = new DOMParser({errorHandler:{warning:invalid,error:invalid,fatalError:invalid}}).parseFromString(text.trim(),"application/xml");
  const root = doc.documentElement;
  if (malformed || root?.localName !== "VehicleDetectManualTrigger") throw new Error("Camera did not return a manual capture result.");
  const nodes = name => Array.from(root.getElementsByTagNameNS(root.namespaceURI,name));
  const single = name => {
    const items = nodes(name);
    return items.length === 1 ? items[0].textContent.trim() : "";
  };
  const time = single("captureTime");
  const eventId = single("imageName");
  const plates = nodes("licensePlate").map(node => node.textContent.trim().toUpperCase());
  if (!time || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(time) || !Number.isFinite(Date.parse(time))) throw new Error("Camera capture time is missing or has no timezone.");
  if (!eventId || plates.length !== 1 || !/^[A-Z0-9 -]{3,20}$/.test(plates[0]) || /^(UNKNOWN|NO PLATE)$/.test(plates[0])) throw new Error("Camera must return one identified plate and a capture ID.");
  const decimals = time.match(/\.(\d+)/)?.[1]?.length || 0;
  return { capturedAt: Date.parse(time), timestampResolutionMs: decimals ? 10 ** Math.max(0, 3 - decimals) : 1000, eventId, value: plates[0] };
}
function requestCamera(options, authorization) {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname:options.ip, port:options.port, path:MANUAL_PATH, method:"GET", headers:authorization ? {Authorization:authorization} : {}, timeout:5000, signal:options.signal}, res => {
      if (res.statusCode === 401) { const challenge=res.headers["www-authenticate"] || ""; res.resume(); return resolve({challenge,status:401}); }
      if (res.statusCode !== 200) {res.resume(); return reject(Object.assign(new Error(`Camera manual capture failed (HTTP ${res.statusCode}).`),{status:res.statusCode}));}
      let size=0;const chunks=[];
      res.on("data",chunk=>{size+=chunk.length;if(size>1024*1024)req.destroy(new Error("Camera response too large."));else chunks.push(chunk);});
      res.on("end",()=>resolve({xml:Buffer.concat(chunks).toString("utf8")}));res.on("error",()=>reject(new Error("Camera response failed.")));
    });
    req.on("timeout",()=>req.destroy(new Error("Camera request timed out.")));
    req.on("error",()=>reject(new Error("Cannot reach camera for manual capture.")));req.end();
  });
}
async function triggerManualPlate(options) {
  if (net.isIP(options.ip)!==4 || !Number.isInteger(options.port) || options.port<1 || options.port>65535 || !options.username || !options.password) throw new Error("Camera IP, port and credentials are required.");
  try {
  let result=await requestCamera(options);
  if (result.status===401) result=await requestCamera(options,digestAuthorization(result.challenge,options.username,options.password,MANUAL_PATH));
  if (!result.xml) throw new Error("Camera authentication failed.");
  return parseManualCapture(result.xml);
  } catch (error) {
    if (options.allowStream && ([404,405,501].includes(error.status) || error.message === "Camera did not return a manual capture result.")) {
      return require("./hikvision-stream").triggerStreamPlate(options);
    }
    throw error;
  }
}
module.exports={parseManualCapture,triggerManualPlate,MANUAL_PATH};
