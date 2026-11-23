"use strict";

const { DOMParser } = require("@xmldom/xmldom");

// Parse metadata only. A timestamp string's resolution is not evidence of
// clock accuracy, image exposure time, or association with an operator request.
function parseAnprEvent(xml) {
  if (typeof xml !== "string" || Buffer.byteLength(xml, "utf8") > 128 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Invalid camera event XML.");
  let malformed = false;
  const doc = new DOMParser({errorHandler:{warning:()=>{malformed=true;},error:()=>{malformed=true;},fatalError:()=>{malformed=true;}}}).parseFromString(xml,"application/xml");
  if (malformed || doc.documentElement?.localName !== "EventNotificationAlert") throw new Error("Invalid camera event XML.");
  function single(root, name, required = true) {
    const nodes = root.getElementsByTagName(name);
    if (nodes.length !== 1) { if (!required && nodes.length === 0) return ""; throw new Error(`Camera event requires one ${name}.`); }
    const value = nodes.item(0).textContent.trim();
    if (required && !value) throw new Error(`Camera event requires one ${name}.`);
    return value;
  }
  if (single(doc,"eventType") !== "ANPR") throw new Error("Camera event is not ANPR.");
  const time = single(doc,"dateTime");
  const components = time.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/);
  if (!components || !Number.isFinite(Date.parse(time))) throw new Error("Camera event requires a valid timestamp with timezone.");
  const [,year,month,day,hour,minute,second] = components.map(Number);
  const date = new Date(0); date.setUTCFullYear(year,month-1,day); date.setUTCHours(hour,minute,second,0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month-1 || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) throw new Error("Camera event requires a valid timestamp with timezone.");
  const eventId = single(doc,"UUID");
  if (eventId.length > 200) throw new Error("Invalid camera event identifier.");
  const plate = single(doc,"licensePlate",false).toUpperCase();
  const images = [...Array(doc.getElementsByTagName("pictureInfo").length)].map((_, i) => {
    const item = doc.getElementsByTagName("pictureInfo").item(i);
    return {fileName:single(item,"fileName"),type:single(item,"type")};
  });
  const decimals = time.match(/\.(\d+)/)?.[1]?.length || 0;
  return {eventId, reportedAt:Date.parse(time), timestampResolutionMs:decimals ? 10 ** Math.max(0,3-decimals) : 1000, plate, images};
}

module.exports = { parseAnprEvent };
