"use strict";
const http = require("node:http");
const net = require("node:net");
const Busboy = require("busboy");
const { DOMParser } = require("@xmldom/xmldom");
const LIMIT = 128 * 1024;

function extractPlate(text, report = () => {}, eventInfo = {}) {
  const reject = reason => { report(reason); return null; };
  if (Buffer.byteLength(text, "utf8") > LIMIT || /<!DOCTYPE|<!ENTITY/i.test(text)) return reject("Camera metadata is unsafe or exceeds the size limit.");
  let type, plate, state;
  try {
    if (text.trim().startsWith("{")) {
      const parsed = JSON.parse(text);
      const event = parsed.EventNotificationAlert || parsed;
      type = event.eventType;
      state = event.eventState;
      plate = event.ANPR?.licensePlate;
      eventInfo.id = event.UUID;
      eventInfo.time = event.dateTime;
    } else {
      let invalid = false;
      const doc = new DOMParser({errorHandler:{warning:()=>{invalid=true;},error:()=>{invalid=true;},fatalError:()=>{invalid=true;}}}).parseFromString(text.trim(), "application/xml");
      if (invalid || doc.documentElement?.localName !== "EventNotificationAlert") return reject("Unexpected camera XML format.");
      const ns = doc.documentElement.namespaceURI;
      const types = doc.getElementsByTagNameNS(ns, "eventType");
      const blocks = doc.getElementsByTagNameNS(ns, "ANPR");
      const states = doc.getElementsByTagNameNS(ns, "eventState");
      if (states.length > 1) return reject("Multiple event states in camera metadata.");
      state = states.length ? states.item(0).textContent.trim() : undefined;
      if (types.length !== 1) return reject("Missing or ambiguous camera event type.");
      type = types.item(0).textContent.trim();
      if (type !== "ANPR") return reject("Camera sent a non-ANPR event.");
      if (blocks.length !== 1) return reject("Missing or ambiguous ANPR block.");
      const plates = blocks.item(0).getElementsByTagNameNS(ns, "licensePlate");
      if (plates.length !== 1) return reject("Missing or ambiguous license plate field.");
      plate = plates.item(0).textContent.trim();
      for (const [key, tag] of [["id","UUID"],["time","dateTime"]]) {
        const matches = doc.getElementsByTagNameNS(ns, tag);
        if (matches.length === 1) eventInfo[key] = matches.item(0).textContent.trim();
      }
    }
  } catch (_) { return reject("Could not decode camera metadata."); }
  if (type !== "ANPR") return reject("Camera sent a non-ANPR event.");
  if (state !== undefined && state !== "active") return reject("Camera sent an inactive event.");
  if (typeof plate !== "string") return reject("Missing license plate text.");
  plate = plate.trim().toUpperCase();
  return /^[A-Z0-9 -]{3,20}$/.test(plate) && !/^(UNKNOWN|NO PLATE|N\/A)$/.test(plate) ? plate : reject("Camera supplied empty, unknown or unsupported plate text.");
}

// Some indicators append a semicolon to the last disposition parameter.
function singleMetadataPart(bytes, contentType) {
  const boundary = contentType.match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!boundary) return null;
  const delimiter = "--" + (boundary[1] || boundary[2]);
  const parts = bytes.toString("utf8").split(delimiter);
  if (parts.length !== 3 || parts[0].trim() || parts[2].trim() !== "--") return null;
  const headerEnd = parts[1].indexOf("\r\n\r\n");
  if (headerEnd < 0 || headerEnd > 8192) return null;
  const headers = parts[1].slice(0,headerEnd);
  if (!/^Content-Disposition:\s*form-data;[^\r\n]*\b(?:name|filename)="[^"]+\.(?:xml|json)";?\s*$/im.test(headers)) return null;
  if (/^Content-Type:\s*image\//im.test(headers)) return null;
  return parts[1].slice(headerEnd + 4).trim();
}

// Only metadata is buffered. Image parts are drained without storing them.
function createAnprReceiver({ cameraIp, port, onPlate, onStatus, currentCycle = () => 0, onActivity = () => {} }) {
  if (net.isIP(cameraIp) !== 4 || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Enter a valid camera IPv4 address and listener port (1024–65535).");
  const recentIds = new Set();
  let latestDeviceTime = -Infinity;
  const server = http.createServer((req, res) => {
    const requestCycle = currentCycle();
    const remote = String(req.socket.remoteAddress || "").replace(/^::ffff:/, "");
    if (req.method !== "POST" || req.url !== "/anpr" || remote !== cameraIp) {
      onActivity(remote !== cameraIp ? "Event rejected: source IP does not match camera IP." : "Request rejected: check notification path /anpr.");
      res.writeHead(403); res.end(); req.resume(); return;
    }
    onActivity("Camera request received; checking metadata.");
    const contentType = String(req.headers["content-type"] || "");
    const multipart = /^multipart\/(?:form-data|mixed)(?:;|$)/i.test(contentType);
    let smallUpload = multipart ? [] : null;
    let metadata = null, invalid = false, total = 0, done = false;
    let ancillaryReason = "";
    const accept = text => {
      let reason;
      extractPlate(text, message => { reason = message; });
      if (reason === "Camera sent a non-ANPR event." || reason === "Camera sent an inactive event.") {
        ancillaryReason = reason;
        return;
      }
      if (metadata !== null) invalid = true;
      else metadata = text;
    };
    const finish = () => {
      if (done) return; done = true;
      if (!invalid && !metadata && !ancillaryReason && smallUpload) metadata = singleMetadataPart(Buffer.concat(smallUpload), contentType);
      smallUpload = null;
      let reason = invalid ? "Camera upload was malformed, ambiguous or exceeded a limit." : ancillaryReason || "Camera upload contained no XML or JSON metadata.";
      const info = {};
      let plate = !invalid && metadata !== null ? extractPlate(metadata, message => { reason = message; }, info) : null;
      if (plate && requestCycle !== currentCycle()) {
        plate = null;
        reason = "Skipped an upload that started in the previous weighment cycle.";
      }
      if (plate) {
        const id = typeof info.id === "string" && info.id.length <= 200 ? info.id.trim() : "";
        const time = typeof info.time === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(info.time) ? Date.parse(info.time) : NaN;
        if ((id && recentIds.has(id)) || time < latestDeviceTime) {
          plate = null;
          reason = "Skipped a repeated or older camera event.";
        } else {
          if (id) recentIds.add(id);
          if (recentIds.size > 512) recentIds.delete(recentIds.values().next().value);
          if (Number.isFinite(time)) latestDeviceTime = time;
        }
      }
      if (plate) { onActivity("Camera plate received."); onPlate(plate); }
      else onActivity(reason);
      if (!res.destroyed) { res.writeHead(200, {"Content-Type":"text/plain"}); res.end("OK"); }
    };
    req.on("data", chunk => { total += chunk.length;
      if (smallUpload && total <= LIMIT) smallUpload.push(chunk);
      else smallUpload = null;
      if (total > 32 * 1024 * 1024) { invalid = true; req.destroy(); onActivity("Camera request exceeded the size limit."); } });
    req.on("error", () => onActivity("Camera request interrupted."));
    if (multipart) {
      let parser;
      try { parser = Busboy({headers:{...req.headers, "content-type":contentType.replace(/^multipart\/mixed/i, "multipart/form-data")}, limits:{parts:16, files:12, fields:8, fieldSize:LIMIT, fileSize:32*1024*1024}}); }
      catch (_) { onActivity("Camera multipart format is invalid."); req.resume(); res.writeHead(400); res.end(); return; }
      parser.on("field", (_name, value, info) => { if (info.valueTruncated) invalid = true; else if (/^\s*[<{]/.test(value)) accept(value); });
      parser.on("file", (_name, stream, info) => {
        const isMetadata = /(?:xml|json)/i.test(info.mimeType || "") || /\.(?:xml|json)$/i.test(info.filename || "");
        if (!isMetadata) { stream.resume(); return; }
        let data = "", size = 0;
        stream.on("data", chunk => { size += chunk.length; if (size <= LIMIT) data += chunk.toString("utf8"); else invalid = true; });
        stream.on("limit", () => { invalid = true; });
        stream.on("end", () => { if (size <= LIMIT) accept(data); });
      });
      for (const ev of ["partsLimit", "filesLimit", "fieldsLimit"]) parser.on(ev, () => { invalid = true; });
      parser.on("error", () => { invalid = true; finish(); });
      parser.on("close", finish);
      req.pipe(parser);
    } else {
      let body = "", size = 0;
      req.on("data", chunk => { size += chunk.length; if (size <= LIMIT) body += chunk.toString("utf8"); else invalid = true; });
      req.on("end", () => { accept(body); finish(); });
    }
  });
  server.on("error", (error) => onStatus({ connected: false, status: error.message }));
  return server;
}
module.exports = { createAnprReceiver, extractPlate };
