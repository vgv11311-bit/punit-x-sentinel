"use strict";
const { createCaptureSession } = require("./capture-session");

// The caller must supply physically verified capture timestamps, bounded clock
// errors and lane control. This coordinator cannot prove those inputs itself.
async function coordinateCapture({ id, readScale, cameras, now, maxSkewMs, deadlineMs, maxWeightAgeMs, maxWeightDeltaKg }) {
  if (typeof readScale !== "function" || typeof now !== "function" || !cameras || !["front","rear","container"].every(role => typeof cameras[role] === "function") || !Number.isFinite(maxWeightAgeMs) || maxWeightAgeMs < 0 || !Number.isFinite(maxWeightDeltaKg) || maxWeightDeltaKg < 0) throw new Error("Capture inputs are incomplete.");
  const controller = new AbortController();
  function checkScale(reading, current) {
    if (!reading || !reading.connected || !reading.stable || !Number.isFinite(reading.value) || reading.value <= 0 || !Number.isFinite(reading.sampleAt) || !Number.isFinite(reading.uncertaintyMs) || reading.uncertaintyMs < 0 || !reading.cycleId || current < reading.sampleAt || current - reading.sampleAt > maxWeightAgeMs) throw new Error("A current stable physical scale reading is required.");
  }
  async function beforeDeadline(operation) {
    let timer;
    try {
      const remaining = deadlineMs - now();
      if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("Capture timed out.");
      return await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => { reject(new Error("Capture timed out.")); controller.abort(); }, remaining); })]);
    } finally { clearTimeout(timer); }
  }
  try {
  const first = await beforeDeadline(() => readScale({signal:controller.signal}));
  checkScale(first,now());
  const session = createCaptureSession({ id, weightKg:first.value, weightAt:first.sampleAt, weightUncertaintyMs:first.uncertaintyMs, maxSkewMs, deadlineMs });
  await beforeDeadline(() => Promise.all(["front","rear","container"].map(async role => {
    const result = await cameras[role]({sessionId:id, weightAt:first.sampleAt, signal:controller.signal});
    if (!result || result.role !== role || result.sessionId !== id) throw new Error("Camera result does not belong to this capture session.");
    session.add(result,now());
  })));
  const last = await beforeDeadline(() => readScale({signal:controller.signal}));
  checkScale(last,now());
  if (last.cycleId !== first.cycleId || last.sampleAt < first.sampleAt || Math.abs(last.value - first.value) > maxWeightDeltaKg) throw new Error("Scale changed during capture; start again.");
  return session.complete(now());
  } catch (error) { controller.abort(); throw error; }
}
module.exports = { coordinateCapture };
