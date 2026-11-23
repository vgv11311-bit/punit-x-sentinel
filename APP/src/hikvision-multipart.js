"use strict";

const Busboy = require("busboy");
const { parseAnprEvent } = require("./hikvision-event");

// Experimental parsing only: this does not verify the sender, the timestamp's
// meaning or accuracy, or whether a response belongs to a requested capture.
// JPEG bytes exist only in memory and must be discarded after local OCR.
function parseCameraMultipart(stream, headers) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({headers, limits:{files:3,fields:4,parts:7,fileSize:12*1024*1024,fieldSize:128*1024}});
    } catch (_) { reject(new Error("Invalid camera multipart content type.")); return; }
    const files = new Map(); let xml = null; let failed = false; let total = 0;
    function fail(message) { if (!failed) { failed = true; reject(new Error(message)); } }
    function acceptXml(value) { if (xml !== null) return fail("Multiple camera metadata parts."); xml=value; }
    parser.on("field", (_name, value, info) => {
      if (info.valueTruncated) return fail("Camera metadata too large.");
      if (/^\s*<\?xml|^\s*<EventNotificationAlert\b/i.test(value)) acceptXml(value);
    });
    parser.on("file", (_name, part, info) => {
      const isXml = /(?:^|\/)(?:text\/xml|application\/xml)$/i.test(info.mimeType) || /\.xml$/i.test(info.filename || "");
      const isJpeg = /^image\/(?:jpeg|pjpeg)$/i.test(info.mimeType);
      if (!isXml && !isJpeg) { part.resume(); return; }
      const chunks = []; let size=0; let truncated=false;
      part.on("limit",()=>{truncated=true;fail("Camera event part too large.");});
      part.on("data",chunk=>{
        size+=chunk.length; total+=chunk.length;
        if (total > 24*1024*1024 || (isXml && size > 128*1024)) { fail("Camera event too large."); return; }
        if (!failed) chunks.push(chunk);
      });
      part.on("error",()=>fail("Camera event stream failed."));
      part.on("end",()=>{
        if (failed || truncated) return;
        const bytes=Buffer.concat(chunks);
        if (isXml) return acceptXml(bytes.toString("utf8"));
        if (!info.filename || files.has(info.filename)) return fail("Duplicate or unnamed camera image.");
        files.set(info.filename,bytes);
      });
    });
    for (const kind of ["filesLimit","fieldsLimit","partsLimit"]) parser.on(kind,()=>fail("Too many camera event parts."));
    parser.on("error",()=>fail("Invalid camera multipart body."));
    stream.on("error",()=>fail("Camera event stream failed."));
    parser.on("close",()=>{
      if (failed) return;
      try {
        if (xml === null) throw new Error("Camera metadata missing.");
        const metadata=parseAnprEvent(xml);
        const scenes=metadata.images.filter(item=>item.type === "detectionPicture");
        if (scenes.length !== 1) throw new Error("Camera event needs exactly one scene image reference.");
        const scene=files.get(scenes[0].fileName);
        if (!scene || scene.length < 4 || scene[0] !== 0xff || scene[1] !== 0xd8 || scene[scene.length-2] !== 0xff || scene[scene.length-1] !== 0xd9) throw new Error("Matching JPEG scene image missing or invalid.");
        resolve({metadata,scene});
      } catch (error) { fail(error.message); }
    });
    stream.pipe(parser);
  });
}
module.exports = { parseCameraMultipart };
