"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {parseAnprEvent}=require("../src/hikvision-event");
const event=(time="2026-11-13T15:37:12.485+05:30")=>`<EventNotificationAlert xmlns="http://www.isapi.org/ver20/XMLSchema"><dateTime>${time}</dateTime><eventType>ANPR</eventType><ANPR><licensePlate>t578dze</licensePlate><pictureInfoList><pictureInfo><fileName>scene.jpg</fileName><type>detectionPicture</type></pictureInfo></pictureInfoList></ANPR><UUID>event-123</UUID></EventNotificationAlert>`;
test("event metadata records reported precision and picture references without image bytes",()=>{
 const result=parseAnprEvent(event());assert.equal(result.plate,"T578DZE");assert.equal(result.eventId,"event-123");assert.equal(result.timestampResolutionMs,1);assert.deepEqual(result.images,[{fileName:"scene.jpg",type:"detectionPicture"}]);
 assert.equal(parseAnprEvent(event("2019-03-01T14:21:35+08:00")).timestampResolutionMs,1000);
});
test("event metadata rejects malformed XML, duplicate fields and timestamps without timezone",()=>{
 assert.throws(()=>parseAnprEvent(event().replace('</licensePlate>','</wrong>')),/Invalid camera event XML/);
 assert.throws(()=>parseAnprEvent(event().replace('<UUID>event-123</UUID>','<UUID>one</UUID><UUID>two</UUID>')),/one UUID/);
 assert.throws(()=>parseAnprEvent(event("2026-11-13T15:37:12.485")),/timezone/);
 assert.throws(()=>parseAnprEvent(event("2026-02-30T15:37:12.485Z")),/valid timestamp/);
 assert.throws(()=>parseAnprEvent('<!DOCTYPE x [<!ENTITY x "test">]>'+event()),/Invalid camera event XML/);
});
