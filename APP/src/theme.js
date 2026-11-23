"use strict";
const https = require("node:https");
const THEME_URL = "https://sentinel.puniterp.com/desktop-theme.json";
function validateTheme(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const result = {};
  for (const key of ["background", "surface", "accent"]) {
    if (typeof input[key] !== "string" || !/^#[0-9a-f]{6}$/i.test(input[key])) return null;
    result[key] = input[key].toUpperCase();
  }
  return result;
}
function getTheme() {
  return new Promise((resolve) => {
    let finished = false;
    const finish = (value) => { if (!finished) { finished = true; resolve(value); } };
    const req = https.get(THEME_URL, { headers: { "Cache-Control": "no-cache" } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return finish(null); }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; if (body.length > 4096) { req.destroy(); finish(null); } });
      res.on("end", () => { try { finish(validateTheme(JSON.parse(body))); } catch { finish(null); } });
      res.on("error", () => finish(null));
    });
    req.setTimeout(5000, () => { req.destroy(); finish(null); });
    req.on("error", () => finish(null));
  });
}
module.exports = { validateTheme, getTheme };
