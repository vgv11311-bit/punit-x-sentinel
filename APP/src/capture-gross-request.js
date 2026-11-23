"use strict";

const { buildCustomFields, isPlateField, reportCoreFields, validateDynamicFields } = require("./logic");

// Prototype request builder. The caller must pass an accepted transaction from
// the main process, never a renderer-supplied or unverified device assertion.
function buildCapturedGrossRequest({accepted, fields, definitions, device}) {
  if (!accepted || !accepted.evidence || accepted.requestId !== accepted.evidence.id || !Array.isArray(definitions) || !fields || typeof fields !== "object") throw new Error("A valid capture transaction is required.");
  const {evidence} = accepted;
  const front=evidence.cameras?.front?.value, rear=evidence.cameras?.rear?.value, container=evidence.cameras?.container?.value;
  if (![front,rear,container].every(v=>typeof v === "string" && v.trim()) || !Number.isFinite(evidence.weightKg) || evidence.weightKg<=0 || !Number.isFinite(evidence.weightAt)) throw new Error("Capture evidence is incomplete.");
  const values = {...fields,vehiclePlate:front,trailer_no:rear,container_no:container};
  for (const field of definitions.filter(isPlateField)) values[field.key]=front;
  const errors=validateDynamicFields(definitions,values);
  if (Object.keys(errors).length) return {validationErrors:errors};
  const custom=buildCustomFields(definitions,values);
  if (custom.trailer_no !== rear || custom.container_no !== container) throw new Error("Required rear plate and container fields are not configured.");
  return {vehicle_plate_number:front,...reportCoreFields(values),gross_weight:evidence.weightKg,gross_source:"Live",gross_captured_at:new Date(evidence.weightAt).toISOString(),device:String(device || ""),request_id:evidence.id,status:"tare_pending",custom_fields:custom,capture_evidence:structuredClone(evidence)};
}
module.exports={buildCapturedGrossRequest};
