"use strict";
const crypto = require("node:crypto");
const { MAX_CAPTURE_SKEW_MS } = require("./capture-session");

// For a future operator button. Device adapters must enforce their own trust,
// timing and physical-occupancy requirements before this can be enabled.
function createOperatorCaptureController({ capture, newSessionId = () => crypto.randomUUID() }) {
  if (typeof capture !== "function" || typeof newSessionId !== "function") throw new Error("Capture callback is required.");
  let busy = false;
  return {
    async capture() {
      if (busy) throw new Error("A capture is already in progress.");
      busy = true;
      try { return await capture({ id: newSessionId(), maxSkewMs: MAX_CAPTURE_SKEW_MS }); }
      finally { busy = false; }
    },
    get busy() { return busy; }
  };
}
module.exports = { createOperatorCaptureController };
