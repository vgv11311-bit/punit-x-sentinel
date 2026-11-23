"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateNet,
  makeWeighmentNumber,
  normalizePlate,
  parsePositiveWeight,
  parseScaleLine,
  validateDynamicFields
} = require("../src/logic");

test("calculates a positive net weight", () => {
  assert.equal(calculateNet(28500, 11200), 17300);
});

test("rejects tare greater than gross", () => {
  assert.throws(() => calculateNet(1000, 1200), /cannot be greater/);
});

test("rejects zero and nonnumeric weight", () => {
  assert.throws(() => parsePositiveWeight(0), /greater than zero/);
  assert.throws(() => parsePositiveWeight("abc"), /greater than zero/);
});

test("validates required dynamic fields", () => {
  const errors = validateDynamicFields([
    { key: "vehiclePlate", label: "Vehicle Plate Number", type: "text", required: true, active: true },
    { key: "loads", label: "Loads", type: "number", required: false, active: true }
  ], { vehiclePlate: "", loads: "many" });
  assert.equal(errors.vehiclePlate, "Vehicle Plate Number is required.");
  assert.equal(errors.loads, "Loads must be a number.");
});

test("normalizes vehicle plate and builds daily sequence", () => {
  assert.equal(normalizePlate("  mh 12  ab 1234 "), "MH 12 AB 1234");
  assert.equal(makeWeighmentNumber(8, new Date(2026, 10, 5)), "WB-20261105-0008");
});

test("parses common scale strings", () => {
  assert.deepEqual(parseScaleLine("ST,GS, 28460.5 kg"), { value: 28460.5, unit: "KG", raw: "ST,GS, 28460.5 kg" });
  assert.equal(parseScaleLine("NO WEIGHT"), null);
  assert.equal(parseScaleLine("ACK 1"), null);
  assert.equal(parseScaleLine("CH1 28460kg"), null);
  assert.equal(parseScaleLine("ST,GS, 28460kg ERROR"), null);
  assert.equal(parseScaleLine("ST,GS, 28460 tons"), null);
});
