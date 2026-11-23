"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { validContainerCode, extractContainerCodes, createContainerReader, createContainerTracker, digestAuthorization, getSnapshot } = require("../src/container-ocr");

test("container results are cleared when the current view is blank, changed or ambiguous", () => {
  const tracker = createContainerTracker(), a = "CAIU9720214", b = "MSCU6639871";
  assert.deepEqual(tracker.observe([a]), { clearReading:true, value:null, ambiguous:false });
  assert.equal(tracker.observe([a]).value, a);
  assert.deepEqual(tracker.observe([]), { clearReading:true, ambiguous:false });
  assert.equal(tracker.observe([a]).value, null);
  assert.equal(tracker.observe([a]).value, a);
  assert.equal(tracker.observe([b]).clearReading, true);
  assert.equal(tracker.observe([b]).value, b);
  assert.equal(tracker.observe([a,b]).ambiguous, true);
  assert.equal(tracker.observe([a]).value, null);
});

test("validates ISO 6346 container identifiers and check digits", () => {
  assert.equal(validContainerCode("CAIU9720214"), true);
  assert.equal(validContainerCode("CAIU9720215"), false);
  assert.deepEqual(extractContainerCodes("Container CAIU 972021 4"), ["CAIU9720214"]);
  assert.deepEqual(extractContainerCodes("CAIU9720215"), []);
});
test("generates digest credentials without including the password", () => {
  const auth = digestAuthorization('Digest realm="camera", nonce="abc", qop="auth"', "operator", "secret", "/picture");
  assert.match(auth, /^Digest /); assert.match(auth, /username="operator"/); assert.doesNotMatch(auth, /secret/);
});
test("camera snapshot handles a digest authentication challenge", async () => {
  const server = http.createServer((req, res) => {
    if (!req.headers.authorization) { res.writeHead(401, {"WWW-Authenticate": 'Digest realm="camera", nonce="abc", qop="auth"'}); return res.end(); }
    assert.match(req.headers.authorization, /^Digest /);
    res.writeHead(200, {"Content-Type":"image/jpeg"}); res.end("jpeg bytes");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    assert.equal((await getSnapshot({ip:"127.0.0.1", port:server.address().port, username:"operator", password:"secret"})).toString(), "jpeg bytes");
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
test("local OCR reads two simulated camera snapshots without uploading an image", {timeout: 60000}, async () => {
  const jpeg = fs.readFileSync(path.join(__dirname, "fixtures", "container-sample.jpg"));
  const server = http.createServer((req, res) => { assert.equal(req.url, "/ISAPI/Streaming/channels/101/picture"); res.writeHead(200, {"Content-Type":"image/jpeg"}); res.end(jpeg); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let reader;
  try {
    const found = new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Container OCR timed out")), 45000);
      reader = await createContainerReader({ip:"127.0.0.1", port:server.address().port, username:"operator", password:"test"}, {
        onCode: (code) => { clearTimeout(timeout); resolve(code); }, onStatus: () => {}
      });
    });
    assert.equal(await found, "CAIU9720214");
  } finally { if (reader) await reader.close(); await new Promise((resolve) => server.close(resolve)); }
});

test("OCR reports an ambiguous view containing two valid container numbers", {timeout:60000}, async () => {
  const jpeg = fs.readFileSync(path.join(__dirname, "fixtures", "container-ambiguous.jpg"));
  const server = http.createServer((_req, res) => {res.writeHead(200,{"Content-Type":"image/jpeg"});res.end(jpeg)});
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  let reader; let timeout;
  try {
    const event = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("No ambiguity event")), 45000);
      createContainerReader({ip:"127.0.0.1",port:server.address().port,username:"operator",password:"test"},{
        onCode: () => reject(new Error("Ambiguous input must not return a code")),
        onStatus: status => {if(status.ambiguous) resolve(status);}
      }).then(value => {reader=value;},reject);
    });
    assert.equal((await event).ambiguous,true);
  } finally {clearTimeout(timeout); if(reader) await reader.close(); await new Promise(resolve => server.close(resolve));}
});
