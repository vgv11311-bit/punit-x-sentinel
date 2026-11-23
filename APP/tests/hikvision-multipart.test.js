"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {Readable}=require("node:stream");
const {parseCameraMultipart}=require("../src/hikvision-multipart");

const xml=`<?xml version="1.0"?><EventNotificationAlert xmlns="http://isapi.org"><dateTime>2026-11-13T15:44:10.312+05:30</dateTime><eventType>ANPR</eventType><ANPR><licensePlate>GJ01AB1234</licensePlate><pictureInfoList><pictureInfo><fileName>detectionPicture.jpg</fileName><type>detectionPicture</type></pictureInfo><pictureInfo><fileName>licensePlatePicture.jpg</fileName><type>licensePlatePicture</type></pictureInfo></pictureInfoList></ANPR><UUID>event-123</UUID></EventNotificationAlert>`;
const jpeg=Buffer.from([0xff,0xd8,1,2,3,0xff,0xd9]);
function multipart(parts) {
 const items=[];for (const part of parts) items.push(Buffer.from(`--boundary\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.type}\r\n\r\n`),Buffer.isBuffer(part.body)?part.body:Buffer.from(part.body),Buffer.from("\r\n"));
 items.push(Buffer.from("--boundary--\r\n"));return Buffer.concat(items);
}
const metadata={name:"anpr",filename:"anpr.xml",type:"application/xml",body:xml};
const scene={name:"scene",filename:"detectionPicture.jpg",type:"image/jpeg",body:jpeg};
async function parse(parts){const body=multipart(parts);const chunks=[];for(let i=0;i<body.length;i+=31)chunks.push(body.subarray(i,i+31));return parseCameraMultipart(Readable.from(chunks),{"content-type":"multipart/form-data; boundary=boundary"});}
test("experimental parser matches metadata to an in-memory scene image across fragmented input",async()=>{
 const result=await parse([scene,metadata,{name:"plate",filename:"licensePlatePicture.jpg",type:"image/pjpeg",body:jpeg}]);
 assert.equal(result.metadata.eventId,"event-123");assert.equal(result.metadata.timestampResolutionMs,1);assert.equal(result.metadata.plate,"GJ01AB1234");assert.deepEqual(result.scene,jpeg);
});
test("experimental parser rejects missing, duplicate or invalid scene images",async()=>{
 await assert.rejects(parse([metadata]),/scene image missing/i);
 await assert.rejects(parse([metadata,scene,scene]),/Duplicate/);
 await assert.rejects(parse([metadata,{...scene,body:Buffer.from("not-a-jpeg")}]),/scene image missing or invalid/i);
 await assert.rejects(parse([{...metadata,body:xml.replace("</licensePlate>","</wrong>")},scene]),/Invalid camera event XML/);
});
