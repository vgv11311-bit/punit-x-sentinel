"use strict";

const crypto = require("node:crypto");
const { createCaptureSession, MAX_CAPTURE_SKEW_MS } = require("./capture-session");

// Prototype only. Callers must supply authenticated, physically verified device
// adapters and invalidate on any scale, camera or vehicle-cycle change. A local
// session ID does not establish image provenance or prove lane occupancy.
function createCaptureTransactions({performCapture, verifyCurrent, now = Date.now, newId = () => crypto.randomUUID(), maxHoldMs = 30000}) {
  if (typeof performCapture !== "function" || typeof verifyCurrent !== "function" || typeof now !== "function" || typeof newId !== "function" || !Number.isFinite(maxHoldMs) || maxHoldMs <= 0) throw new Error("Capture transaction configuration is invalid.");
  let generation = 0, busy = false, pending = null;
  // This process-local guard is not a substitute for durable replay prevention
  // across restarts or for matching a camera event to its actual trigger.
  const seenEvents = new Set();

  function invalidate() { generation++; pending = null; }
  function checkCurrent(expectedGeneration, id) {
    if (generation !== expectedGeneration || !pending || pending.capture.id !== id) throw new Error("Capture is no longer valid; start again.");
    const current = now();
    if (!Number.isFinite(current) || current < pending.createdAt || current > pending.createdAt + maxHoldMs) { invalidate(); throw new Error("Capture expired; start again."); }
  }

  return {
    invalidate,
    async capture() {
      if (busy) throw new Error("A capture or save is already in progress.");
      invalidate();
      const expectedGeneration = generation, id = newId();
      busy = true;
      try {
        const result = await performCapture({id, maxSkewMs:MAX_CAPTURE_SKEW_MS});
        if (generation !== expectedGeneration) throw new Error("Capture was invalidated; start again.");
        const createdAt = now();
        if (!Number.isFinite(createdAt) || !result || result.id !== id) throw new Error("Invalid capture result.");
        // Revalidate and copy only the evidence fields; image buffers or other
        // adapter-supplied data are never included in the saved transaction.
        const check = createCaptureSession({id, weightKg:result.weightKg, weightAt:result.weightAt, weightUncertaintyMs:result.weightUncertaintyMs, maxSkewMs:MAX_CAPTURE_SKEW_MS, deadlineMs:createdAt + maxHoldMs});
        for (const role of ["front","rear","container"]) check.add({...result.cameras?.[role], role, sessionId:id}, createdAt);
        const capture = check.complete(createdAt);
        const keys = ["front","rear","container"].map(role => JSON.stringify([role,capture.cameras[role].eventId]));
        if (keys.some(key => seenEvents.has(key))) throw new Error("Camera event was already used; start again with new device events.");
        if (seenEvents.size + keys.length > 30000) throw new Error("Capture replay history is full; commissioning must restart.");
        for (const key of keys) seenEvents.add(key);
        pending = {capture, createdAt};
        return structuredClone(capture);
      } finally { busy = false; }
    },
    async save(id, saveRecord) {
      if (busy) throw new Error("A capture or save is already in progress.");
      if (typeof saveRecord !== "function") throw new Error("Save callback is required.");
      const expectedGeneration = generation;
      checkCurrent(expectedGeneration,id);
      busy = true;
      try {
        // A positive result must represent a live, independently validated check,
        // not a user-supplied assertion or a cached camera/scale value.
        let stillCurrent;
        try { stillCurrent = await verifyCurrent(structuredClone(pending.capture)); }
        catch (error) { invalidate(); throw error; }
        checkCurrent(expectedGeneration,id);
        if (stillCurrent !== true) { invalidate(); throw new Error("Device state changed; start again."); }
        const accepted = pending.capture;
        invalidate(); // Single use, even when the remote outcome is uncertain.
        return await saveRecord({requestId:accepted.id, weightKg:accepted.weightKg, frontPlate:accepted.cameras.front.value, rearPlate:accepted.cameras.rear.value, containerNumber:accepted.cameras.container.value, evidence:structuredClone(accepted)});
      } finally { busy = false; }
    }
  };
}
module.exports = { createCaptureTransactions };
