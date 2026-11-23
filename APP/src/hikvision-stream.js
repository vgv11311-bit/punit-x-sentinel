"use strict";
const http = require("node:http");
const {digestAuthorization} = require("./container-ocr");
const {extractPlate} = require("./anpr");

const ALERT_PATH = "/ISAPI/Event/notification/alertStream";
const TRIGGER_PATH = "/ISAPI/Traffic/MNPR/channels/1?laneNo=1&OSD=1";
async function cameraGet(config, path, signal) {
  const get = authorization => new Promise((resolve,reject) => {
    const request = http.get({hostname:config.ip, port:config.port, path, signal,
      headers:authorization ? {Authorization:authorization} : {}}, resolve);
    request.on("error",reject);
  });
  let response = await get();
  if (response.statusCode === 401) {
    const challenge = response.headers["www-authenticate"] || "";
    response.destroy();
    response = await get(digestAuthorization(challenge,config.username,config.password,path));
  }
  if (response.statusCode !== 200) {
    response.destroy();
    throw new Error("Camera returned HTTP " + response.statusCode + " for " + path.split("?")[0]);
  }
  return response;
}

// Sample the camera's own clock after the tap; the PC can be in a different time zone.
async function freshCaptureBoundary(config) {
  const response = await cameraGet(config,"/ISAPI/System/time",AbortSignal.timeout(5000));
  let xml = "";
  for await (const chunk of response) {
    xml += chunk.toString("utf8");
    if (xml.length > 16384) throw new Error("Unexpected camera clock response.");
  }
  const times = [...xml.matchAll(/<(?:[\w-]+:)?localTime\b[^>]*>\s*(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.(\d+))?(?:Z|[+-]\d\d:\d\d))\s*<\//g)];
  if (times.length !== 1 || !Number.isFinite(Date.parse(times[0][1]))) throw new Error("Camera did not provide a clock with a time zone. Cannot verify a fresh plate.");
  const precision = 10 ** Math.max(0,3-(times[0][2]?.length || 0));
  // Wait through the reported clock tick so a pre-tap image in the same tick cannot qualify.
  await new Promise(resolve => setTimeout(resolve,precision));
  return Date.parse(times[0][1]) + precision;
}

// Consume bounded parts from an open-ended MIME stream. Never wait for stream EOF.
async function nextPlate(stream, boundary, minimumTime) {
  const marker = Buffer.from("\r\n--" + boundary);
  let tail = Buffer.from("\r\n"), chunks = [], size = 0, started = false;
  const append = bytes => {
    if (!started) return;
    size += bytes.length;
    if (size <= 136*1024) chunks.push(bytes);
    else chunks = [];
  };
  for await (const chunk of stream) {
    const data = Buffer.concat([tail,chunk]);
    let start = 0, end;
    while ((end = data.indexOf(marker,start)) >= 0) {
      append(data.subarray(start,end));
      if (started && chunks.length) {
        const part = Buffer.concat(chunks);
        const split = part.indexOf("\r\n\r\n");
        if (split >= 0 && split <= 8192 && !/^Content-Type:\s*image\//im.test(part.toString("ascii",0,split))) {
          const info = {};
          const value = extractPlate(part.toString("utf8",split+4), undefined, info);
          const capturedAt = Date.parse(info.time);
          if (value && typeof info.id === "string" && info.id.trim() && info.id.length <= 200 &&
              typeof info.time === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(info.time) && Number.isFinite(capturedAt) && capturedAt >= minimumTime) {
            const decimals = info.time.match(/\.(\d+)/)?.[1]?.length || 0;
            return {value, eventId:info.id.trim(), capturedAt, timestampResolutionMs:10 ** Math.max(0, 3 - decimals)};
          }
        }
      }
      started = true; size = 0; chunks = [];
      start = end + marker.length;
    }
    const keep = Math.max(start,data.length-marker.length+1);
    append(data.subarray(start,keep));
    tail = Buffer.from(data.subarray(keep));
  }
  throw new Error("Camera closed the event stream before delivering an identified plate.");
}

async function triggerStreamPlate(config) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),8000);
  let stream, trigger;
  try {
    stream = await cameraGet(config,ALERT_PATH,controller.signal);
    const match = (stream.headers["content-type"] || "").match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
    const boundary = match && (match[1] || match[2]);
    if (!boundary || boundary.length > 100) throw new Error("Camera did not supply a multipart alert stream.");
    // Start reading before issuing the trigger so a fast event is not lost.
    const results = await Promise.all([nextPlate(stream,boundary,config.minimumTime ?? -Infinity), (async()=>{
      trigger = await cameraGet(config,TRIGGER_PATH,controller.signal);
      trigger.resume();
    })()]);
    return results[0];
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Camera did not deliver a fresh identified plate within eight seconds.");
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
    stream?.destroy();
    trigger?.destroy();
  }
}
module.exports = {freshCaptureBoundary,triggerStreamPlate,ALERT_PATH,TRIGGER_PATH};
