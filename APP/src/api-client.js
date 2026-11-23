"use strict";

function unwrap(payload) {
  if (payload && typeof payload === "object" && payload.data !== undefined) return payload.data;
  return payload;
}

function extractToken(payload) {
  const body = unwrap(payload) || {};
  return body.token || body.access_token || body.api_token || payload?.token || payload?.access_token || null;
}

function extractCollection(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  return [];
}

function normalizeFieldType(type) {
  const value = String(type || "text").toLowerCase().replace(/[\s_-]+/g, "");
  if (["select", "dropdown", "choice", "enum"].includes(value)) return "dropdown";
  if (["datetime", "dateandtime", "timestamp"].includes(value)) return "datetime";
  if (["number", "numeric", "integer", "decimal", "float"].includes(value)) return "number";
  if (["boolean", "bool", "checkbox"].includes(value)) return "checkbox";
  if (value === "date") return "date";
  return "text";
}

function normalizeOptions(options) {
  if (!options) return [];
  if (typeof options === "string") {
    try { return normalizeOptions(JSON.parse(options)); } catch (_error) { return options.split(",").map((item) => item.trim()).filter(Boolean); }
  }
  if (Array.isArray(options)) return options.map((item) => typeof item === "object" ? String(item.label ?? item.name ?? item.value ?? item.id) : String(item));
  return Object.entries(options).map(([value, label]) => String(label ?? value));
}

function canonicalFieldKey(field, index) {
  const raw = String(field.key ?? field.field_key ?? field.slug ?? field.name ?? `field_${field.id ?? index + 1}`);
  const simplified = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["vehicleplate", "vehicleplatenumber", "vehiclenumber", "registrationnumber"].includes(simplified)) return "vehiclePlate";
  if (["driver", "drivername"].includes(simplified)) return "driverName";
  if (["material", "materialitem", "materialname", "item", "itemname"].includes(simplified)) return "material";
  if (["challan", "challannumber", "documentnumber"].includes(simplified)) return "challanNumber";
  if (["transporttype", "movementtype"].includes(simplified)) return "transportType";
  return raw;
}

function normalizeFields(payload) {
  return extractCollection(payload, "fields").map((field, index) => ({
    serverId: field.id ?? null,
    serverKey: String(field.slug ?? field.field_key ?? field.key ?? field.name ?? `field_${field.id ?? index + 1}`),
    key: canonicalFieldKey(field, index),
    label: String(field.label ?? field.field_label ?? field.display_name ?? field.name ?? `Field ${index + 1}`),
    type: normalizeFieldType(field.type ?? field.field_type),
    required: Boolean(field.required ?? field.is_required),
    active: (field.active ?? field.is_active ?? true) !== false,
    order: Number(field.order ?? field.display_order ?? field.sort_order ?? index + 1),
    placeholder: String(field.placeholder ?? ""),
    defaultValue: field.default_value ?? field.default ?? "",
    options: normalizeOptions(field.options ?? field.dropdown_options ?? field.values)
  })).sort((a, b) => a.order - b.order);
}

function fieldValueMap(record) {
  const output = {};
  const direct = record.fields ?? record.field_values ?? record.custom_field_values;
  if (direct && !Array.isArray(direct) && typeof direct === "object") Object.assign(output, direct);
  const rows = Array.isArray(direct) ? direct : (record.custom_fields ?? record.customFields ?? record.custom ?? []);
  if (record.custom && !Array.isArray(record.custom) && typeof record.custom === "object") Object.assign(output, record.custom);
  for (const row of Array.isArray(rows) ? rows : []) {
    const definition = row.field ?? row.definition ?? {};
    const key = row.key ?? row.field_key ?? row.slug ?? definition.key ?? definition.slug ?? definition.name ?? row.field_id ?? definition.id;
    if (key !== undefined) output[String(key)] = row.value ?? row.field_value ?? row.selected_value ?? "";
  }
  return output;
}

function firstValue(source, keys, fallback = "") {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function normalizeWeighment(record) {
  const custom = fieldValueMap(record);
  const merged = { ...record, ...custom };
  const grossWeight = Number(firstValue(merged, ["gross_weight", "grossWeight", "gross"], 0)) || 0;
  const tareRaw = firstValue(merged, ["tare_weight", "tareWeight", "tare"], null);
  const tareWeight = tareRaw === null || tareRaw === "" ? null : Number(tareRaw);
  const netRaw = firstValue(merged, ["net_weight", "netWeight", "net"], null);
  const netWeight = netRaw === null || netRaw === "" ? (tareWeight === null ? null : grossWeight - tareWeight) : Number(netRaw);
  const statusText = String(firstValue(merged, ["status"], tareWeight === null ? "tare_pending" : "completed")).toLowerCase();
  const completed = statusText.includes("complete") || tareWeight !== null;
  const createdAt = firstValue(merged, ["created_at", "createdAt", "gross_at", "gross_date"], new Date().toISOString());
  const updatedAt = firstValue(merged, ["updated_at", "updatedAt", "tare_at", "tare_date"], createdAt);
  return {
    id: `remote-${record.id}`,
    serverId: record.id,
    weighmentNumber: String(firstValue(merged, ["weighment_number", "weighment_no", "ticket_number", "number"], record.id)),
    status: completed ? "COMPLETED" : "TARE_PENDING",
    fields: {
      ...custom,
      vehiclePlate: String(firstValue(merged, ["vehiclePlate", "vehicle_plate", "vehicle_plate_number", "vehicle_number", "registration_number"], custom.vehiclePlate ?? "")),
      driverName: String(firstValue(merged, ["driverName", "driver_name", "driver"], custom.driverName ?? "")),
      material: String(firstValue(merged, ["material", "material_name", "item", "item_name"], custom.material ?? ""))
    },
    gross: grossWeight > 0 ? {
      weight: grossWeight,
      source: String(firstValue(merged, ["gross_source", "grossSource"], "Live")),
      capturedAt: firstValue(merged, ["gross_at", "gross_date", "gross_captured_at"], createdAt),
      operator: String(firstValue(merged, ["gross_operator", "operator_name", "operator"], "Server")),
      device: String(firstValue(merged, ["gross_device", "device"], "API"))
    } : null,
    tare: tareWeight !== null ? {
      weight: tareWeight,
      source: String(firstValue(merged, ["tare_source", "tareSource"], "Live")),
      capturedAt: firstValue(merged, ["tare_at", "tare_date", "tare_captured_at"], updatedAt),
      operator: String(firstValue(merged, ["tare_operator", "operator_name", "operator"], "Server")),
      device: String(firstValue(merged, ["tare_device", "device"], "API"))
    } : null,
    netWeight,
    createdAt,
    updatedAt,
    requestIds: [],
    syncStatus: "SYNCED",
    raw: record
  };
}

function normalizeWeighments(payload) {
  return extractCollection(payload, "weighments").map(normalizeWeighment).filter((record) => record.gross);
}

class ApiClient {
  constructor({ baseUrl, token = "", fetchImpl = globalThis.fetch }) {
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async request(path, options = {}) {
    const headers = { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...options, signal: options.signal || AbortSignal.timeout(30000), headers, body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body });
    const text = await response.text();
    let payload = null;
    if (text) { try { payload = JSON.parse(text); } catch (_error) { payload = { message: text }; } }
    if (!response.ok) {
      const message = payload?.message || payload?.error || `API request failed with status ${response.status}.`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  async login(email, password) {
    const payload = await this.request("/auth/token", { method: "POST", body: { email, password } });
    const token = extractToken(payload);
    if (!token) throw new Error("The API did not return a Bearer token.");
    this.token = token;
    return token;
  }

  me() { return this.request("/me"); }
  verifyPassword(password) { return this.request("/auth/verify-password", { method: "POST", body: { password } }); }
  async report(id, password) {
    if (!/^\d+$/.test(String(id)) || !password) throw new Error('A record and password are required.');
    const response = await this.fetchImpl(`${this.baseUrl}/weighments/${id}/inward-report`, {method:'POST', headers:{Accept:'application/pdf, application/json','Content-Type':'application/json',Authorization:`Bearer ${this.token}`},body:JSON.stringify({password}),signal:AbortSignal.timeout(60000)});
    if (!response.ok) { let data={}; try { data=await response.json(); } catch (_) {} throw new Error(data.errors?.password?.[0] || data.message || `Download failed (${response.status}).`); }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.headers.get('content-type')?.includes('application/pdf') || bytes.subarray(0,5).toString() !== '%PDF-') throw new Error('The server did not return a valid PDF.');
    return bytes;
  }
  fields() { return this.request("/fields"); }
  settings() { return this.request("/settings"); }
  weighments(query = "page=1&per_page=100") { return this.request(`/weighments?${query}`); }
  async allWeighments() {
    const records = [];
    let page = 1;
    for (;;) {
      const payload = await this.weighments(`page=${page}&per_page=100`);
      records.push(...extractCollection(payload, "weighments"));
      const lastPage = Number(payload?.meta?.last_page ?? payload?.data?.meta?.last_page ?? 1);
      if (!Number.isInteger(lastPage) || lastPage < 1) throw new Error("The server returned invalid weighment pagination.");
      if (page >= lastPage) return records;
      if (++page > 1000) throw new Error("Too many weighment pages to load. Contact support.");
    }
  }
  createWeighment(body) { return this.request("/weighments", { method: "POST", body }); }
  weighment(id) { return this.request(`/weighments/${encodeURIComponent(id)}`); }
  updateWeighment(id, body) { return this.request(`/weighments/${encodeURIComponent(id)}`, { method: "PUT", body }); }
  revoke() { return this.request("/auth/token", { method: "DELETE" }); }
}

module.exports = { ApiClient, extractCollection, extractToken, normalizeFields, normalizeWeighment, normalizeWeighments };
