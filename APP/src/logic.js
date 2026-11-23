"use strict";

const crypto = require("node:crypto");

function createRequestId(prefix = "REQ") {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function parsePositiveWeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error("Weight must be a number greater than zero.");
  }
  return Math.round(number * 100) / 100;
}

function validateDynamicFields(fields, values) {
  const errors = {};
  for (const field of fields.filter((item) => item.active !== false)) {
    const value = values[field.key];
    if (field.required && (value === undefined || value === null || (typeof value === "string" && value.trim() === "") || value === false)) {
      errors[field.key] = `${field.label} is required.`;
    }
    if (field.type === "number" && value !== "" && value !== undefined && !Number.isFinite(Number(value))) {
      errors[field.key] = `${field.label} must be a number.`;
    }
  }
  return errors;
}

function isPlateField(field) {
  const canonical = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return ["vehicleplate", "vehicleplatenumber", "vehiclenumber", "truckplateno", "registrationnumber"].includes(canonical(field.key)) || ["vehicleplate", "vehicleplatenumber", "vehiclenumber", "truckplateno", "registrationnumber"].includes(canonical(field.label));
}

function reportCoreFields(values) {
  return { driver_name: String(values.driverName || "").trim(), material: String(values.material || "").trim() };
}

function buildCustomFields(fields, values) {
  const custom = {};
  for (const field of fields) {
    if (field.active === false || field.serverId == null) continue;
    const key = field.serverKey || field.key;
    if (Object.prototype.hasOwnProperty.call(values, field.key)) custom[key] = values[field.key];
  }
  return custom;
}

function calculateNet(gross, tare) {
  const grossWeight = parsePositiveWeight(gross);
  const tareWeight = parsePositiveWeight(tare);
  if (tareWeight > grossWeight) {
    throw new Error("Tare weight cannot be greater than gross weight.");
  }
  return Math.round((grossWeight - tareWeight) * 100) / 100;
}

function normalizePlate(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function makeWeighmentNumber(sequence, date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `WB-${y}${m}${d}-${String(sequence).padStart(4, "0")}`;
}

function parseScaleLine(line) {
  const ds3 = String(line || "").match(/^\x02([+-])(\d{6})([0-4])([0-9A-F]{2})\x03$/i);
  if (ds3) {
    const payload = ds3[1] + ds3[2] + ds3[3];
    const checksum = [...payload].reduce((value, char) => value ^ char.charCodeAt(0), 0);
    if (checksum !== parseInt(ds3[4], 16) || ds3[1] === "-") return null;
    return { value: Number(ds3[2]) / (10 ** Number(ds3[3])), unit: "KG", raw: "XK3190-DS3" };
  }
  const text = String(line || "").trim();
  if (/(?:^|[,\s])(?:US|UNSTABLE|OL|OVERLOAD)(?:$|[,\s])/i.test(text)) return null;
  const match = text.match(/^(?:(?:ST|S|GS|G|NT|N)\s*[,\s:]\s*)*([-+]?\d+(?:\.\d+)?)\s*(KG|KGS)?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) return null;
  return { value, unit: "KG", raw: text };
}

module.exports = {
  calculateNet,
  buildCustomFields,
  isPlateField,
  createRequestId,
  makeWeighmentNumber,
  normalizePlate,
  parsePositiveWeight,
  parseScaleLine,
  reportCoreFields,
  validateDynamicFields
};
