"use strict";

const { randomUUID } = require("node:crypto");
const { buildCustomFields, isPlateField, reportCoreFields, validateDynamicFields } = require("./logic");
const ROLES = ["front", "rear", "container"];

// Receipt times are deliberately NOT represented as exposure/measurement times.
// This workflow needs an operator to check a single occupied lane. It makes no
// one-second guarantee. Uncertain HTTP outcomes retain the exact request on disk.
function createStandardCapture({ readDevices, readJournal, writeJournal, send, now = Date.now, newId = randomUUID }) {
  let pending = null, busy = false;
  function devices() {
    const current = readDevices(), time = now();
    const fresh = (at, limit) => Number.isFinite(at) && time >= at && time - at <= limit;
    if (!current.scale?.connected || !current.scale.stable || !(current.scale.value > 0) || !fresh(current.scale.at, 3000)) throw new Error("A current stable RS-232 reading is required.");
    for (const role of ROLES) {
      const camera = current.cameras?.[role];
      if (!camera?.connected || camera.conflict || !camera.value || !fresh(camera.at, 30000)) throw new Error(`A recent, unambiguous ${role} camera reading is required.`);
    }
    return current;
  }
  function invalidate() { pending = null; }
  function check() {
    if (!pending) throw new Error("Press Capture before saving.");
    try {
      const current = devices();
      if (now() < pending.capturedAt || now() > pending.expiresAt || Math.abs(current.scale.value - pending.weightKg) > 0.5 || ROLES.some(role => current.cameras[role].value !== pending.cameras[role].value)) throw new Error("Capture expired or devices changed. Check the truck and capture again.");
      return pending;
    } catch (error) { invalidate(); throw error; }
  }
  function journal() { return readJournal(); }
  function status(owner) {
    const saved = journal();
    if (saved?.status === "pending") return { status:"retry", id:saved.body.request_id, sameOperator:saved.owner === owner, snapshot:saved.snapshot, busy };
    try { check(); } catch (_) { /* invalid pending captures must disappear */ }
    return pending ? {status:"captured", snapshot:structuredClone(pending), busy} : {status:"idle",busy};
  }
  return {
    invalidate, status,
    capture({owner, confirmed, mode = "standard"}) {
      if (busy) throw new Error("A save is already in progress.");
      if (mode !== "standard") throw new Error("One-second mode requires on-site timing verification and is not enabled.");
      if (!owner || confirmed !== true) throw new Error("Confirm the three identifiers belong to the only truck on the scale.");
      if (journal()?.status === "pending") throw new Error("Resolve the pending save before capturing another truck.");
      invalidate();
      const current = devices(), time = now();
      pending = {id:newId(), mode:"standard", owner, capturedAt:time, expiresAt:time + 30000, weightKg:current.scale.value, weightReceivedAt:current.scale.at, device:current.scale.device,
        cameras:Object.fromEntries(ROLES.map(role=>[role,{value:current.cameras[role].value, receivedAt:current.cameras[role].at}]))};
      return structuredClone(pending);
    },
    async save({id, owner, fields, definitions, beforeSave = () => {}}) {
      if (busy) throw new Error("A save is already in progress.");
      let saved = journal();
      const retrying = saved?.status === "pending";
      if (saved?.status === "complete" && saved.body.request_id === id && saved.owner === owner) return structuredClone(saved.response);
      if (saved?.status === "pending") {
        if (saved.body.request_id !== id || saved.owner !== owner) throw new Error("Retry the original pending save using the same operator account.");
      } else {
        const capture = check();
        if (capture.id !== id || capture.owner !== owner) throw new Error("Capture does not match this session.");
        const values = {...fields,vehiclePlate:capture.cameras.front.value,trailer_no:capture.cameras.rear.value,container_no:capture.cameras.container.value};
        for (const field of definitions.filter(isPlateField)) values[field.key] = values.vehiclePlate;
        const errors = validateDynamicFields(definitions, values);
        if (Object.keys(errors).length) return {validationErrors:errors};
        const custom = buildCustomFields(definitions,values);
        if (custom.trailer_no !== values.trailer_no || custom.container_no !== values.container_no) throw new Error("Refresh required report fields before saving.");
        const body = {vehicle_plate_number:values.vehiclePlate,...reportCoreFields(values),gross_weight:capture.weightKg,gross_source:"Live",gross_captured_at:new Date(capture.weightReceivedAt).toISOString(),device:capture.device,request_id:capture.id,status:"tare_pending",custom_fields:custom,
          capture_workflow:{mode:"standard",id:capture.id,operatorConfirmed:true,capturedAt:capture.capturedAt,weightReceivedAt:capture.weightReceivedAt,cameras:structuredClone(capture.cameras)}};
        beforeSave(body);
        saved = {status:"pending",owner,body,snapshot:structuredClone(capture)};
        writeJournal(saved); // durable before sending, including before any await
        invalidate();
      }
      busy = true;
      try {
        const response = await send(structuredClone(saved.body));
        writeJournal({...saved,status:"complete",response});
        return response;
      } catch (error) {
        // A validation rejection means no record was created. Network/5xx/401
        // outcomes remain pending, including failures while fetching the result.
        if (error.definitiveRejection === true && !retrying) writeJournal(null);
        throw error;
      } finally { busy = false; }
    }
  };
}
module.exports = { createStandardCapture };
