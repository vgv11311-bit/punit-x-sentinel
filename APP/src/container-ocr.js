"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const net = require("node:net");
const path = require("node:path");
const { createWorker } = require("tesseract.js");

// ISO 6346: three owner letters, an equipment category, six serial digits and a check digit.
function validContainerCode(code) {
  if (!/^[A-Z]{3}[UJZ]\d{7}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let n = Number(code[i]);
    if (i < 4) {
      n = code.charCodeAt(i) - 65 + 10;
      n += Math.floor((n - 1) / 10);
    }
    sum += n * (2 ** i);
  }
  return (sum % 11) % 10 === Number(code[10]);
}
function extractContainerCodes(text) {
  const compact = String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const codes = new Set();
  for (let i = 0; i <= compact.length - 11; i++) {
    const candidate = compact.slice(i, i + 11);
    if (validContainerCode(candidate)) codes.add(candidate);
  }
  return [...codes];
}

// A fresh frame with no match or a changed match invalidates an earlier result.
function createContainerTracker() {
  let pending = null, same = 0;
  return {
    observe(codes) {
      if (codes.length !== 1) {
        pending = null; same = 0;
        return { clearReading: true, ambiguous: codes.length > 1 };
      }
      const changed = pending !== codes[0];
      same = changed ? 1 : same + 1;
      pending = codes[0];
      return { clearReading: changed, value: same >= 2 ? pending : null, ambiguous: false };
    },
    reset() { pending = null; same = 0; }
  };
}

function requestSnapshot({ ip, port, username, password }, authorization) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: ip, port, path: "/ISAPI/Streaming/channels/101/picture", method: "GET", headers: authorization ? { Authorization: authorization } : {}, timeout: 5000 }, (res) => {
      if (res.statusCode === 401) { const challenge = res.headers["www-authenticate"] || ""; res.resume(); return resolve({ challenge, status: 401 }); }
      if (res.statusCode !== 200 || !/^image\/jpeg/i.test(res.headers["content-type"] || "")) { res.resume(); return reject(new Error("Camera snapshot unavailable; check IP, credentials and ISAPI access.")); }
      let size = 0; const chunks = [];
      res.on("data", (chunk) => { size += chunk.length; if (size > 12 * 1024 * 1024) req.destroy(new Error("Camera snapshot exceeds size limit.")); else chunks.push(chunk); });
      res.on("end", () => resolve({ image: Buffer.concat(chunks) }));
      res.on("aborted", () => reject(new Error("Camera snapshot was interrupted.")));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("Camera snapshot timed out.")));
    req.on("error", () => reject(new Error("Cannot reach the container camera.")));
    req.end();
  });
}
function digestAuthorization(challenge, username, password, uri) {
  if (/^Basic\s/i.test(challenge)) return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  if (!/^Digest\s/i.test(challenge)) throw new Error("Camera authentication method is not supported.");
  const attrs = {};
  for (const match of challenge.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g)) attrs[match[1].toLowerCase()] = match[2] ?? match[3];
  const algorithm = (attrs.algorithm || "MD5").toUpperCase();
  if (!attrs.realm || !attrs.nonce || !["MD5", "SHA-256"].includes(algorithm) || (attrs.qop && !attrs.qop.split(",").map((x) => x.trim()).includes("auth"))) throw new Error("Camera digest authentication is not supported.");
  const hash = (s) => crypto.createHash(algorithm.toLowerCase().replace("-", "")).update(s).digest("hex");
  const nc = "00000001", cnonce = crypto.randomBytes(12).toString("hex");
  const ha1 = hash(`${username}:${attrs.realm}:${password}`), ha2 = hash(`GET:${uri}`);
  const response = attrs.qop ? hash(`${ha1}:${attrs.nonce}:${nc}:${cnonce}:auth:${ha2}`) : hash(`${ha1}:${attrs.nonce}:${ha2}`);
  const quote = (s) => String(s).replace(/["\\]/g, "\\$&");
  return `Digest username="${quote(username)}", realm="${quote(attrs.realm)}", nonce="${quote(attrs.nonce)}", uri="${uri}", response="${response}", algorithm=${algorithm}${attrs.qop ? `, qop=auth, nc=${nc}, cnonce="${cnonce}"` : ""}${attrs.opaque ? `, opaque="${quote(attrs.opaque)}"` : ""}`;
}
async function getSnapshot(options) {
  const first = await requestSnapshot(options);
  if (first.image) return first.image;
  const auth = digestAuthorization(first.challenge, options.username, options.password, "/ISAPI/Streaming/channels/101/picture");
  const second = await requestSnapshot(options, auth);
  if (!second.image) throw new Error("Container camera rejected the credentials.");
  return second.image;
}

async function createContainerReader(options, { onCode, onStatus }) {
  if (net.isIP(options.ip) !== 4 || !Number.isInteger(options.port) || options.port < 1 || options.port > 65535 || !options.username || !options.password) throw new Error("Enter the camera IPv4 address, HTTP port, username and password.");
  const language = require("@tesseract.js-data/eng");
  const worker = await createWorker("eng", 1, { langPath: language.langPath, gzip: true, cacheMethod: "none", logger: () => {} });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: "11", tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" });
  } catch (error) {
    await worker.terminate();
    throw error;
  }
  let stopped = false, timer = null;
  const tracker = createContainerTracker();
  const reader = { listening: false, cameraIp: options.ip, async close() { stopped = true; reader.listening = false; clearTimeout(timer); await worker.terminate(); } };
  async function tick() {
    if (stopped) return;
    try {
      const observedAt = Date.now();
      const image = await getSnapshot(options);
      if (stopped) return;
      reader.listening = true; onStatus({ connected: true, status: "Camera connected; scanning for container number" });
      const result = await worker.recognize(image);
      if (stopped) return;
      const codes = extractContainerCodes(result.data.text);
      const observation = tracker.observe(codes);
      if (observation.clearReading) onStatus({ connected: true, clearReading: true, ambiguous: observation.ambiguous, status: observation.ambiguous ? "Multiple container numbers seen; clear the weighbridge and adjust the camera view." : "Waiting for a confirmed container number." });
      if (observation.value && Date.now() - observedAt <= 30000) onCode(observation.value, observedAt);
    } catch (error) {
      const message = String(error?.message || "");
      const status = /rejected the credentials/i.test(message) ? "Container camera rejected its username or password." :
        /authentication method|digest authentication/i.test(message) ? "Container camera authentication method is not supported." :
        /snapshot unavailable/i.test(message) ? "Container snapshot unavailable; check ISAPI and camera channel." :
        "Container camera or OCR unavailable. Check camera settings and connection.";
      if (!stopped) { reader.listening = false; tracker.reset(); onStatus({ connected: false, status }); }
    } finally { if (!stopped) timer = setTimeout(tick, 500); }
  }
  tick();
  return reader;
}
module.exports = { createContainerReader, createContainerTracker, extractContainerCodes, validContainerCode, digestAuthorization, getSnapshot };
