"use strict";

// A capture session groups already-verified device events. It does not itself
// authenticate a camera, prove lane occupancy, or synchronize device clocks.
const ROLES = ["front", "rear", "container"];
const MAX_CAPTURE_SKEW_MS = 1000;
function createCaptureSession({ id, weightKg, weightAt, weightUncertaintyMs, maxSkewMs, deadlineMs }) {
  if (typeof id !== "string" || !id || !Number.isFinite(weightKg) || weightKg <= 0 || !Number.isFinite(weightAt) || !Number.isFinite(weightUncertaintyMs) || weightUncertaintyMs < 0 || !Number.isFinite(maxSkewMs) || maxSkewMs < 0 || maxSkewMs > MAX_CAPTURE_SKEW_MS || !Number.isFinite(deadlineMs) || deadlineMs <= weightAt) throw new Error("Invalid capture session parameters.");
  const events = new Map();
  let failed = null;
  let completed = false;
  return {
    add(event, receivedAt) {
      if (failed) throw new Error(failed);
      if (completed) throw new Error("Capture is already complete.");
      if (!Number.isFinite(receivedAt) || receivedAt > deadlineMs) { failed = "Capture expired."; throw new Error(failed); }
      if (!event || event.sessionId !== id || !ROLES.includes(event.role) || typeof event.eventId !== "string" || !event.eventId || typeof event.value !== "string" || !event.value.trim() || !Number.isFinite(event.capturedAt) || !Number.isFinite(event.timestampResolutionMs) || event.timestampResolutionMs <= 0 || !Number.isFinite(event.clockUncertaintyMs) || event.clockUncertaintyMs < 0) { failed = "Invalid or unrelated camera event."; throw new Error(failed); }
      if (event.capturedAt - event.clockUncertaintyMs < weightAt + weightUncertaintyMs || event.capturedAt - event.clockUncertaintyMs > receivedAt) { failed = "Camera capture could not be proven to follow the weight reading."; throw new Error(failed); }
      const worstCaseSkew = Math.abs(event.capturedAt - weightAt) + event.timestampResolutionMs + event.clockUncertaintyMs + weightUncertaintyMs;
      if (worstCaseSkew > maxSkewMs) { failed = "Camera capture time or uncertainty was outside the permitted time window."; throw new Error(failed); }
      for (const [role, prior] of events) if (role !== event.role && prior.eventId === event.eventId) { failed = "A camera event was reused for another role."; throw new Error(failed); }
      if (events.has(event.role)) { failed = "Duplicate or conflicting readings for one camera."; throw new Error(failed); }
      events.set(event.role, {eventId:event.eventId, value:event.value, capturedAt:event.capturedAt, timestampResolutionMs:event.timestampResolutionMs, clockUncertaintyMs:event.clockUncertaintyMs});
    },
    complete(now) {
      if (failed) throw new Error(failed);
      if (completed) throw new Error("Capture is already complete.");
      if (!Number.isFinite(now) || now > deadlineMs) throw new Error("Capture expired.");
      if (ROLES.some(role => !events.has(role))) throw new Error("All three camera results are required.");
      completed = true;
      return { id, weightKg, weightAt, weightUncertaintyMs, maxSkewMs, cameras: Object.fromEntries(events) };
    }
  };
}
module.exports = { createCaptureSession, MAX_CAPTURE_SKEW_MS };
