"use strict";

const { app, BrowserWindow, ipcMain, safeStorage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const {
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
} = require("./src/logic");
const { getTheme } = require("./src/theme");
const { createAnprReceiver } = require("./src/anpr");
const { createContainerReader } = require("./src/container-ocr");
const { createSerialFramer, decodeLineEnding } = require("./src/serial-framer");
const { ApiClient, normalizeFields, normalizeWeighment, normalizeWeighments } = require("./src/api-client");

const { createStandardCapture } = require("./src/standard-capture");

const API_BASE_URL = "https://sentinel.puniterp.com/api/v1";

let mainWindow;
let serialPort;
let serialFramer = null;
let serialClosing = Promise.resolve();
let serialConnecting = false;
let simulatorTimer;
let stableSamples = [];
let latestScaleReading = null;
const cameraServers = { front: null, rear: null, container: null };
const cameraConnecting = { front: null, rear: null };
const cameraGeneration = { front: 0, rear: 0 };
const { triggerManualPlate } = require("./src/hikvision-manual");
let cameraCycle = 0;
const cameraReadings = { front: null, rear: null, container: null };
const cameraConflicts = { front: false, rear: false, container: false };
let lastContainerReading = null;
const cameraActivity = { front: "", rear: "" };
let containerStatus = "Container camera stopped";
let containerGeneration = 0;
let loadedCycle = false;
let cycleConsumed = false;
let sessionToken = "";
let sessionEmail = "";

// Journal is separate from synced state so refreshes cannot erase uncertain saves.
const grossCapture = createStandardCapture({
  readDevices: () => ({
    scale: {connected: Boolean(serialPort?.isOpen) && latestScaleReading?.mode === "serial" && !cycleConsumed, stable:latestScaleReading?.stable, value:latestScaleReading?.value, at:Date.parse(latestScaleReading?.receivedAt), device:loadState().settings.serial.path},
    cameras:Object.fromEntries(["front","rear","container"].map(role => [role,{connected:Boolean(cameraServers[role]?.listening) && !cycleConsumed,conflict:cameraConflicts[role],value:cameraReadings[role]?.value,at:cameraReadings[role]?.at}]))
  }),
  readJournal: () => {
    const file = path.join(app.getPath("userData"), "gross-save-journal.json");
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,"utf8")) : null;
  },
  writeJournal: (value) => {
    const file = path.join(app.getPath("userData"), "gross-save-journal.json");
    fs.mkdirSync(path.dirname(file), {recursive:true});
    fs.writeFileSync(file + ".tmp", JSON.stringify(value), "utf8");
    fs.renameSync(file + ".tmp", file);
  },
  send: async (body) => {
    let response;
    try { response = await apiClient().createWeighment(body); }
    catch (error) { if (error.status === 422 || error.status === 403) error.definitiveRejection = true; throw error; }
    const serverRecord = response?.data || response?.weighment || response;
    if (!serverRecord?.id) throw new Error("Server response is incomplete. Retry the original save.");
    cycleConsumed = true; emitCamera(cameraState());
    const refreshed = await apiClient().weighment(serverRecord.id);
    const record = {...normalizeWeighment(refreshed?.data || refreshed?.weighment || refreshed),requestIds:[body.request_id],syncStatus:"SYNCED"};
    const state = loadState();
    state.records = [record,...state.records.filter(item => item.id !== record.id)];
    if (!state.auditLog.some(item => item.requestId === body.request_id)) state.auditLog.unshift({id:crypto.randomUUID(),recordId:record.id,action:"GROSS_SAVED",at:body.gross_captured_at,operator:state.currentUser.name,requestId:body.request_id,value:body.gross_weight,captureWorkflow:body.capture_workflow});
    persistState(state);
    return {state:publicStateFrom(state),record,localOnly:false};
  }
});

function nowIso() {
  return new Date().toISOString();
}

function defaultState() {
  const timestamp = nowIso();
  return {
    version: 2,
    sequence: 1,
    currentUser: {
      id: "OP-001",
      name: "Punit Operator",
      role: "Weighbridge Operator",
      permissions: ["manual_weight", "serial_settings"]
    },
    config: {
      lastUpdated: timestamp,
      weightUnit: "KG",
      fields: [
        { key: "vehiclePlate", label: "Vehicle Plate Number", type: "text", required: true, active: true, order: 1, placeholder: "e.g. MH 12 AB 1234" },
        { key: "driverName", label: "Driver Name", type: "text", required: true, active: true, order: 2, placeholder: "Enter driver name" },
        { key: "material", label: "Material / Item", type: "dropdown", required: true, active: true, order: 3, options: ["Iron Ore", "Coal", "Cement", "Sand", "Aggregate"] },
        { key: "supplier", label: "Supplier", type: "text", required: false, active: true, order: 4, placeholder: "Supplier or customer" },
        { key: "challanNumber", label: "Challan Number", type: "text", required: false, active: true, order: 5, placeholder: "Document reference" },
        { key: "transportType", label: "Transport Type", type: "dropdown", required: false, active: true, order: 6, options: ["Inbound", "Outbound", "Internal"] }
      ]
    },
    settings: {
      apiBaseUrl: API_BASE_URL,
      syncMode: "remote",
      manualRequiresReason: false,
      cameras: {
        front: { ip: "", port: 8031 }, rear: { ip: "", port: 8032 },
        container: { ip: "", port: 80, username: "" }
      },
      serial: {
        path: "",
        baudRate: 9600,
        dataBits: 8,
        parity: "none",
        stopBits: 1,
        lineEnding: "\\r\\n"
      }
    },
    records: [],
    auditLog: []
  };
}

function statePath() {
  return path.join(app.getPath("userData"), "sentinel-data.json");
}

function authPath() {
  return path.join(app.getPath("userData"), "sentinel-auth.json");
}

function migrateState(state) {
  const migrated = { ...defaultState(), ...state };
  migrated.settings = { ...defaultState().settings, ...(state.settings || {}), apiBaseUrl: API_BASE_URL, syncMode: "remote", serial: { ...defaultState().settings.serial, ...(state.settings?.serial || {}) } };
  const defaults = defaultState().settings.cameras;
  migrated.settings.cameras = Object.fromEntries(Object.keys(defaults).map((role) => [role, { ...defaults[role], ...(state.settings?.cameras?.[role] || {}) }]));
  if (migrated.settings.serial.path === "SIMULATOR") migrated.settings.serial.path = "";
  migrated.config = { ...defaultState().config, ...(state.config || {}) };
  migrated.records = (state.records || []).filter((record) => !String(record.id || "").startsWith("rec-seed-"));
  migrated.auditLog = state.auditLog || [];
  migrated.version = 2;
  return migrated;
}

function loadStoredAuth() {
  if (sessionToken) return { token: sessionToken, email: sessionEmail };
  const file = authPath();
  if (!fs.existsSync(file)) return { token: "", email: "" };
  try {
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!safeStorage.isEncryptionAvailable() || !stored.encryptedToken) return { token: "", email: "" };
    sessionToken = safeStorage.decryptString(Buffer.from(stored.encryptedToken, "base64"));
    sessionEmail = stored.email || "";
    return { token: sessionToken, email: sessionEmail };
  } catch (_error) {
    return { token: "", email: "" };
  }
}

function saveStoredAuth(token, email) {
  sessionToken = token;
  sessionEmail = email;
  fs.mkdirSync(path.dirname(authPath()), { recursive: true });
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(authPath(), JSON.stringify({ email, encryptedToken: safeStorage.encryptString(token).toString("base64") }, null, 2), "utf8");
  }
}

function clearStoredAuth() {
  for (const role of ["front","rear"]) {
    cameraGeneration[role]++;
    const server = cameraServers[role];
    if (server) { delete server.cameraLogin; delete server.loginOwner; }
  }
  sessionToken = "";
  sessionEmail = "";
  if (fs.existsSync(authPath())) fs.unlinkSync(authPath());
}

function apiClient() {
  const { token } = loadStoredAuth();
  return new ApiClient({ baseUrl: API_BASE_URL, token });
}

function ensureVehiclePlateField(fields) {
  if (!fields.some((field) => field.key === "vehiclePlate")) {
    fields.unshift({ key: "vehiclePlate", label: "Vehicle Plate Number", type: "text", required: true, active: true, order: 0, placeholder: "e.g. RJ14 AB 1234", options: [] });
  }
  for (const field of [
    { key: "driverName", label: "Driver's Name", order: 1 },
    { key: "material", label: "Product", order: 2 }
  ]) {
    const existing = fields.find((item) => item.key === field.key);
    if (existing) existing.required = true;
    else fields.push({ ...field, type: "text", required: true, active: true, options: [] });
  }
  const reportSlugs = new Set(["gate", "trailer_no", "container_no", "container_type", "container_size", "driver_licence", "product_count_desc", "customer_client_name", "agent_name", "transporter", "cargo_type"]);
  for (const field of fields) if (reportSlugs.has(field.key)) field.required = true;
  return fields;
}

function loadState() {
  const file = statePath();
  if (!fs.existsSync(file)) {
    const initial = defaultState();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
  try {
    const loaded = migrateState(JSON.parse(fs.readFileSync(file, "utf8")));
    persistState(loaded);
    return loaded;
  } catch (error) {
    const backup = `${file}.corrupt-${Date.now()}`;
    fs.copyFileSync(file, backup);
    const initial = defaultState();
    fs.writeFileSync(file, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
}

function persistState(state) {
  const file = statePath();
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(temp, file);
}

function rememberCamera(role, values) {
  const state = loadState();
  state.settings.cameras[role] = { ...state.settings.cameras[role], ...values };
  persistState(state);
}

function publicStateFrom(state, auth = {}) {
  const stored = loadStoredAuth();
  return {
    ...state,
    dataFile: statePath(),
    auth: {
      authenticated: Boolean(stored.token),
      email: stored.email,
      user: auth.user || state.currentUser,
      lastSync: auth.lastSync || state.lastSync || null,
      error: auth.error || null
    }
  };
}

async function syncRemoteState({ throwOnError = false } = {}) {
  const state = loadState();
  const stored = loadStoredAuth();
  if (!stored.token) return publicStateFrom(state);
  try {
    const client = apiClient();
    const [mePayload, fieldsPayload, settingsPayload, weighmentsPayload] = await Promise.all([
      client.me(), client.fields(), client.settings(), client.allWeighments()
    ]);
    const meBody = mePayload?.data || mePayload || {};
    const user = meBody.user || mePayload?.user || meBody;
    const fields = ensureVehiclePlateField(normalizeFields(fieldsPayload));
    const remoteRecords = normalizeWeighments(weighmentsPayload);
    for (const record of remoteRecords) {
      for (const field of fields) {
        if (field.serverId !== null && record.fields[String(field.serverId)] !== undefined && record.fields[field.key] === undefined) {
          record.fields[field.key] = record.fields[String(field.serverId)];
        }
      }
    }
    const remoteSettings = settingsPayload?.data || settingsPayload?.settings || settingsPayload || {};
    if (fields.length) state.config.fields = fields;
    state.config.lastUpdated = nowIso();
    state.config.weightUnit = String(remoteSettings.weight_unit ?? remoteSettings.weightUnit ?? state.config.weightUnit ?? "KG");
    state.settings.manualRequiresReason = Boolean(remoteSettings.manual_requires_reason ?? remoteSettings.manualRequiresReason ?? state.settings.manualRequiresReason);
    // Locally cached legacy records have no customer identity and must not be shown to another login.
    state.records = remoteRecords;
    state.currentUser = {
      id: user.id ?? state.currentUser.id,
      name: user.name ?? user.full_name ?? user.email ?? stored.email,
      role: user.role?.name ?? user.role ?? "Weighbridge Operator",
      permissions: user.permissions ?? state.currentUser.permissions
    };
    state.lastSync = nowIso();
    persistState(state);
    return publicStateFrom(state, { user: state.currentUser, lastSync: state.lastSync });
  } catch (error) {
    // Access must be revalidated online; never expose cached customer data after an invalid session or network failure.
    clearStoredAuth();
    if (throwOnError) throw error;
    return publicStateFrom(state, { error: error.message });
  }
}

function createWindow() {
  const qaCapture = process.env.SENTINEL_QA_SCREENSHOT_DIR;
  mainWindow = new BrowserWindow({
    width: qaCapture ? 1800 : 1480,
    height: qaCapture ? 1150 : 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#08111f",
    title: "Sentinel Weighbridge",
    autoHideMenuBar: true,
    show: !qaCapture,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
  if (qaCapture) {
    mainWindow.webContents.once("did-finish-load", async () => {
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const capture = async (name) => {
        await wait(900);
        const image = await mainWindow.webContents.capturePage();
        fs.mkdirSync(qaCapture, { recursive: true });
        fs.writeFileSync(path.join(qaCapture, `${name}.png`), image.toPNG());
      };
      try {
        await capture("01-overview");
        await mainWindow.webContents.executeJavaScript('setView("gross")');
        await capture("02-gross");
        await mainWindow.webContents.executeJavaScript('setView("tare")');
        await wait(500);
        await mainWindow.webContents.executeJavaScript('document.querySelector("[data-pending-id]")?.click()');
        await capture("03-tare");
        await mainWindow.webContents.executeJavaScript('setView("settings")');
        await capture("04-configuration");
      } finally {
        app.quit();
      }
    });
  }
}

function emitScale(payload) {
  if (!payload.stable) grossCapture.invalidate();
  else grossCapture.status(loadStoredAuth().email);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("scale:reading", payload);
}

function emitCamera(status) {
  grossCapture.status(loadStoredAuth().email);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("camera:status", status);
}
function plateComparisonKey(value) { return normalizePlate(value).replace(/\s/g, ""); }
function cameraState() {
  const roleState = (role) => {
    const reading = cameraReadings[role];
    const recent = reading && Date.now() - reading.at < 30000 && !cameraConflicts[role] && !cycleConsumed;
    const expired = reading && !recent && !cameraConflicts[role] && !cycleConsumed;
    const expiryMessage = expired ? `Last reading ${reading.value} at ${new Date(reading.at).toLocaleTimeString()} expired. Request a fresh capture.` : "";
    const server = cameraServers[role];
    return { verifiedId: recent && reading.verifiedUntil > Date.now() ? reading.verifiedId : undefined, conflictMessage:cameraConflicts[role] ? server?.conflictMessage : undefined, ip:server?.cameraIp, directReady:Boolean(sessionToken && server?.loginOwner === sessionToken && server?.cameraLogin),
      listening: Boolean(server?.listening), value: recent ? reading.value : "", conflict: cameraConflicts[role], status: expiryMessage || cameraActivity[role] || "" };
  };
  const front = roleState("front");
  return { ...front, plate: front.value, front, rear: roleState("rear"), container: { ...roleState("container"), status: containerStatus }, consumed: cycleConsumed };
}
function clearCameraCycle() {
  cameraCycle++;
  grossCapture.invalidate();
  for (const role of ["front", "rear", "container"]) { cameraReadings[role] = null; cameraConflicts[role] = false; if (cameraServers[role]) delete cameraServers[role].conflictMessage; }
  lastContainerReading = null;
  loadedCycle = false; cycleConsumed = false; emitCamera(cameraState());
}
function checkedCameraPlate(role = "front") {
  const state = cameraState()[role];
  if (!state.listening || !state.value) throw new Error(state.conflict ? `More than one ${role} plate detected. Clear the weighbridge before trying again.` : `A recent ${role} camera plate is required for this weighing.`);
  return state.value;
}
function updateStable(parsed) {
  if (latestScaleReading && Date.now() - Date.parse(latestScaleReading.receivedAt) > 3000) stableSamples = [];
  stableSamples.push(parsed.value);
  if (stableSamples.length > 5) stableSamples.shift();
  const stable = stableSamples.length >= 3 && Math.max(...stableSamples) - Math.min(...stableSamples) <= 0.5;
  latestScaleReading = { ...parsed, stable, receivedAt: nowIso() };
  if (stable && parsed.value > 0) loadedCycle = true;
  if (stable && parsed.value === 0 && loadedCycle) clearCameraCycle();
  emitScale(latestScaleReading);
}

function liveWeight() {
  if (!serialPort || !serialPort.isOpen || !latestScaleReading || latestScaleReading.mode !== "serial" || !latestScaleReading.stable || Date.now() - Date.parse(latestScaleReading.receivedAt) > 3000) throw new Error("A current stable scale reading is required.");
  return parsePositiveWeight(latestScaleReading.value);
}

function stopConnections() {
  if (simulatorTimer) clearInterval(simulatorTimer);
  simulatorTimer = null;
  stableSamples = [];
  latestScaleReading = null;
  if (serialFramer) serialFramer.reset();
  serialFramer = null;
  if (serialPort && serialPort.isOpen) {
    const closingPort = serialPort;
    closingPort.removeAllListeners();
    serialClosing = new Promise((resolve) => closingPort.close(() => resolve()));
  }
  serialPort = null;
  clearCameraCycle();
  return serialClosing;
}

function startSimulator(baseWeight = 28460) {
  stopConnections();
  let tick = 0;
  simulatorTimer = setInterval(() => {
    tick += 1;
    const settling = tick < 7;
    const jitter = settling ? (7 - tick) * 13 : (tick % 9 === 0 ? 0.4 : 0);
    updateStable({ value: Math.round((Number(baseWeight) + jitter) * 10) / 10, unit: "KG", raw: `ST,GS,${baseWeight + jitter}kg`, mode: "simulator" });
  }, 650);
  return { connected: true, path: "SIMULATOR", simulated: true };
}

async function connectSerial(options) {
  if (!options.path || options.path === "SIMULATOR") throw new Error("Select a physical COM port in Configuration before connecting.");
  const delimiter = decodeLineEnding(options.lineEnding || "\\r\\n");
  if (serialConnecting) throw new Error("A scale connection is already in progress.");
  serialConnecting = true;
  try {
  await stopConnections();
  let SerialPort;
  try {
    ({ SerialPort } = require("serialport"));
  } catch (error) {
    throw new Error("Serial driver is unavailable. Run the dependency installer or use the simulator.");
  }
  serialPort = new SerialPort({
    path: options.path,
    baudRate: Number(options.baudRate || 9600),
    dataBits: Number(options.dataBits || 8),
    parity: options.parity || "none",
    stopBits: Number(options.stopBits || 1),
    autoOpen: false
  });
  await new Promise((resolve, reject) => serialPort.open((error) => error ? reject(error) : resolve()));
  serialFramer = createSerialFramer({
    delimiter,
    onOverflow: () => { stableSamples = []; latestScaleReading = null; emitScale({ invalid: true, value: null, stable: false, status: "Invalid scale data; check indicator settings." }); },
    onLine: (line) => {
      const parsed = parseScaleLine(line);
      if (parsed) updateStable({ ...parsed, mode: "serial" });
      else { stableSamples = []; latestScaleReading = null; emitScale({ value: null, stable: false, invalid: true, receivedAt: nowIso(), mode: "serial" }); }
    }
  });
  serialPort.on("data", (chunk) => serialFramer?.push(chunk));
  serialPort.on("error", (error) => { latestScaleReading = null; stableSamples = []; clearCameraCycle(); emitScale({ error: error.message, disconnected: true }); });
  serialPort.on("close", () => { latestScaleReading = null; stableSamples = []; clearCameraCycle(); emitScale({ disconnected: true }); });
  return { connected: true, path: options.path, simulated: false };
  } finally { serialConnecting = false; }
}

function registerHandlers() {
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:theme", () => getTheme());
  ipcMain.handle("app:get-state", () => syncRemoteState());
  ipcMain.handle("app:sync", () => syncRemoteState({ throwOnError: true }));
  ipcMain.handle("report:download", async (_event, id, password) => {
    if (!loadStoredAuth().token) throw new Error('Sign in before downloading.');
    if (!/^\d+$/.test(String(id)) || typeof password !== 'string' || !password || password.length > 1024) throw new Error('Enter your account password.');
    const pdf = await apiClient().report(id, password);
    const folder = app.getPath('downloads');
    for (let n = 0; n < 1000; n++) {
      const target = path.join(folder, `Inward-Cargo-${id}${n ? ` (${n})` : ''}.pdf`);
      try { fs.writeFileSync(target, pdf, {flag:'wx'}); return target; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    throw new Error('Could not choose a unique file name in Downloads.');
  });
  ipcMain.handle("app:refresh-fields", async () => {
    if (!loadStoredAuth().token) throw new Error("Sign in again to refresh fields.");
    const state = loadState();
    let fields;
    try { fields = ensureVehiclePlateField(normalizeFields(await apiClient().fields())); }
    catch (error) {
      if (error.status !== 401 && error.status !== 403) throw error;
      clearStoredAuth(); grossCapture.invalidate(); stopConnections();
      return { accessDenied:true, state:publicStateFrom(state, {error:'Account access is disabled, expired, or needs sign-in.'}) };
    }
    const previous = JSON.stringify(state.config.fields || []);
    const changed = previous !== JSON.stringify(fields);
    if (changed) {
      state.config.fields = fields;
      state.config.lastUpdated = nowIso();
      persistState(state);
    }
    return { fields: state.config.fields, lastUpdated: state.config.lastUpdated, changed };
  });
  ipcMain.handle("auth:login", async (_event, credentials) => {
    const email = String(credentials?.email || "").trim();
    const password = String(credentials?.password || "");
    if (!email || !password) throw new Error("Email and password are required.");
    const client = new ApiClient({ baseUrl: API_BASE_URL });
    try {
      const token = await client.login(email, password);
      saveStoredAuth(token, email);
      return await syncRemoteState({ throwOnError: true });
    } catch (error) {
      clearStoredAuth();
      throw error;
    }
  });
  ipcMain.handle("auth:logout", async () => {
    try {
      if (loadStoredAuth().token) await apiClient().revoke();
    } catch (_error) {
      // Clear the local session even if the server is temporarily unavailable.
    }
    grossCapture.invalidate();
    clearStoredAuth();
    return publicStateFrom(loadState());
  });
  ipcMain.handle("app:reset-demo", () => {
    stopConnections();
    const state = defaultState();
    state.settings.serial = loadState().settings.serial;
    persistState(state);
    return publicStateFrom(state);
  });
  ipcMain.handle("app:update-settings", async (_event, changes, password) => {
    if (changes.serial) {
      if (!loadStoredAuth().token || !password) throw new Error("Enter your Sentinel account password to save scale settings.");
      await apiClient().verifyPassword(String(password));
    }
    const state = loadState();
    if (changes.serial && Object.entries(changes.serial).some(([key, value]) => String(state.settings.serial[key]) !== String(value))) { stopConnections(); emitScale({ disconnected: true }); }
    state.settings = { ...state.settings, ...changes, apiBaseUrl: API_BASE_URL, syncMode: "remote", serial: { ...state.settings.serial, ...(changes.serial || {}) } };
    persistState(state);
    return publicStateFrom(state);
  });
  ipcMain.handle("capture:status", () => grossCapture.status(loadStoredAuth().email));
  ipcMain.handle("capture:clear", () => { grossCapture.invalidate(); return grossCapture.status(loadStoredAuth().email); });
  ipcMain.handle("capture:gross", (_event, options) => {
    if (!loadStoredAuth().token) throw new Error("Sign in before capturing.");
    return grossCapture.capture({owner:loadStoredAuth().email,confirmed:options?.confirmed,mode:options?.mode});
  });
  ipcMain.handle("app:save-gross", async (_event, payload) => {
    if (!loadStoredAuth().token) throw new Error("Sign in before saving.");
    const state = loadState();
    return grossCapture.save({id:payload.captureId,owner:loadStoredAuth().email,fields:payload.fields,definitions:state.config.fields,
      beforeSave: (body) => {
        const required = ["gate","trailer_no","container_no","container_type","container_size","driver_licence","product_count_desc","customer_client_name","agent_name","transporter","cargo_type"];
        if (required.some(key => !state.config.fields.some(field => field.key === key && field.active !== false && field.required))) throw new Error("Refresh the required inward-cargo report fields before saving.");
        if (state.records.some(record => record.status === "TARE_PENDING" && normalizePlate(record.fields.vehiclePlate) === normalizePlate(body.vehicle_plate_number))) throw new Error("This truck already has a pending gross entry. Complete its tare first.");
      }
    });
  });
  ipcMain.handle("app:save-tare", async (_event, payload) => {
    if (grossCapture.status(loadStoredAuth().email).status === "retry") throw new Error("Resolve the pending gross save before saving tare.");
    const state = loadState();
    const requestId = payload.requestId || createRequestId("TARE");
    const record = state.records.find((item) => item.id === payload.recordId);
    if (!record) throw new Error("Pending gross record was not found.");
    if (record.requestIds?.includes(requestId)) return { state: publicStateFrom(state), record, duplicate: true };
    if (record.status === "COMPLETED" || record.tare) return { alreadyCompleted: true, record };
    if (normalizePlate(checkedCameraPlate()).replace(/\s/g, "") !== normalizePlate(record.fields.vehiclePlate).replace(/\s/g, "")) throw new Error("Camera plate does not match this pending weighment.");
    const tareWeight = liveWeight();
    payload.source = "Live";
    const netWeight = calculateNet(record.gross.weight, tareWeight);
    if (payload.source === "Manual" && state.settings.manualRequiresReason && !String(payload.reason || "").trim()) {
      return { validationErrors: { manualReason: "A reason is required for manual weight." } };
    }
    const timestamp = nowIso();
    const tare = { weight: tareWeight, source: payload.source, reason: payload.reason || "", capturedAt: timestamp, operator: state.currentUser.name, device: payload.device || (payload.source === "Manual" ? "Manual" : state.settings.serial.path) };
    if (record.serverId) {
      if (!loadStoredAuth().token) throw new Error("Sign in again before updating a server weighment.");
      const client = apiClient();
      const refreshedPayload = await client.updateWeighment(record.serverId, { tare_weight: tareWeight });
      const refreshedBody = refreshedPayload?.data || refreshedPayload?.weighment || refreshedPayload;
      const refreshed = normalizeWeighment(refreshedBody);
      Object.assign(record, refreshed, { requestIds: [...(record.requestIds || []), requestId], syncStatus: "SYNCED" });
    } else {
      record.tare = tare;
      record.netWeight = netWeight;
      record.status = "COMPLETED";
      record.updatedAt = timestamp;
      record.requestIds = [...(record.requestIds || []), requestId];
      record.syncStatus = "LOCAL_ONLY";
    }
    cycleConsumed = true; emitCamera(cameraState());
    state.auditLog.unshift({ id: crypto.randomUUID(), recordId: record.id, action: "TARE_SAVED", at: timestamp, operator: state.currentUser.name, requestId, oldValue: null, newValue: tareWeight, netWeight });
    persistState(state);
    return { state: publicStateFrom(state), record, localOnly: !record.serverId };
  });
  ipcMain.handle("camera:connect", async (_event, options) => {
    const role = options.role || "front";
    if (!["front", "rear"].includes(role)) throw new Error("Container OCR requires a supported camera or recognition integration.");
    const cameraIp = String(options.ip || "").trim();
    if (cameraConnecting[role]) throw new Error("Camera listener is already starting.");
    const otherRoles = role === "front" ? ["rear", "container"] : ["front", "container"];
    if (otherRoles.some((otherRole) => cameraServers[otherRole]?.cameraIp === cameraIp || cameraConnecting[otherRole]?.ip === cameraIp)) throw new Error("Each camera must use a different IP address.");
    const generation = ++cameraGeneration[role];
    cameraConnecting[role] = { ip: cameraIp };
    try {
    if (cameraServers[role]) {
      const previous = cameraServers[role]; cameraServers[role] = null;
      await new Promise((resolve) => previous.close(() => resolve()));
    }
    clearCameraCycle();
    cameraActivity[role] = "Listener active · waiting for camera events";
    const port = Number(options.port);
    const server = createAnprReceiver({ cameraIp, port, currentCycle: () => cameraCycle, onActivity: (status) => { if (cameraServers[role] !== server) return; cameraActivity[role] = new Date().toLocaleTimeString() + " - " + status; emitCamera(cameraState()); }, onStatus: () => { if (cameraServers[role] !== server) return; cameraServers[role] = null; clearCameraCycle(); }, onPlate: (value) => {
      if (cameraServers[role] !== server || cycleConsumed) return;
      if (server.verification) {
        if (server.verification.observed.size < 3) server.verification.observed.add(plateComparisonKey(value));
        return;
      }
      const previous = cameraReadings[role];
      if (previous && Date.now() - previous.at < 30000 && plateComparisonKey(previous.value) !== plateComparisonKey(value)) {
        server.conflictMessage = `At ${new Date().toLocaleTimeString()}, camera read both ${previous.value} and ${value}. Request a fresh plate with only this vehicle in view.`;
        cameraConflicts[role] = true;
      }
      else if (!cameraConflicts[role]) {
        const same = previous && plateComparisonKey(previous.value) === plateComparisonKey(value);
        cameraReadings[role] = {value, at:Date.now(), verifiedId:same ? previous.verifiedId : undefined, verifiedUntil:same ? previous.verifiedUntil : undefined};
      }
      emitCamera(cameraState());
    }});
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "0.0.0.0", () => { server.removeListener("error", reject); resolve(); }); });
    if (cameraGeneration[role] !== generation) {
      await new Promise(resolve => server.close(resolve));
      throw new Error("Camera listener start was cancelled.");
    }
    server.cameraIp = cameraIp;
    rememberCamera(role, { ip: cameraIp, port });
    cameraServers[role] = server; emitCamera(cameraState());
    return { ...cameraState(), cameraIp, port };
    } finally {
      cameraConnecting[role] = null;
    }
  });
  ipcMain.handle("camera:verify-plate", async (_event, options) => {
    const {role} = options;
    if (!["front", "rear"].includes(role)) throw new Error("Select a plate camera.");
    const server = cameraServers[role];
    if (!server?.listening) throw new Error("Start this camera listener first.");
    if (options.ip !== server.cameraIp) throw new Error("Camera IP changed. Restart this listener first.");
    if (!sessionToken || cycleConsumed) throw new Error("A signed-in, open weighment cycle is required.");
    if (server.verification) throw new Error("Camera verification is already running.");
    const login = options.username && options.password
      ? {username:options.username,password:options.password,port:Number(options.httpPort)}
      : server.loginOwner === sessionToken && server.cameraLogin;
    if (!login) throw new Error("Enter the camera username and password to trigger a fresh reading.");
    if (!Number.isInteger(login.port) || login.port < 1 || login.port > 65535) throw new Error("Enter a valid camera HTTP port.");
    const owner = sessionToken;
    const cycle = cameraCycle;
    const checkCycle = () => {
      if (cameraServers[role] !== server || cameraCycle !== cycle || cycleConsumed || sessionToken !== owner)
        throw new Error("Weighment cycle changed. Request a new capture.");
    };
    const started = Date.now();
    const previousConflict = cameraConflicts[role];
    const verification = {observed: new Set()};
    server.verification = verification;
    grossCapture.invalidate();
    cameraReadings[role] = null;
    cameraConflicts[role] = true;
    emitCamera(cameraState());
    try {
      const config = {ip:server.cameraIp, ...login, allowStream:true};
      config.minimumTime = await require("./src/hikvision-stream").freshCaptureBoundary(config);
      checkCycle();
      const first = await triggerManualPlate(config);
      checkCycle();
      if (first.timestampResolutionMs >= 1) {
        await new Promise(resolve => setTimeout(resolve, first.timestampResolutionMs));
        checkCycle();
      }
      const second = await triggerManualPlate(config);
      checkCycle();
      if (first.capturedAt < config.minimumTime || second.capturedAt < config.minimumTime || first.eventId === second.eventId)
        throw new Error("Camera returned an older or repeated image. Capture again.");
      verification.observed.add(plateComparisonKey(first.value));
      verification.observed.add(plateComparisonKey(second.value));
      if (verification.observed.size !== 1) {
        server.conflictMessage = "Camera readings disagree (" + [...verification.observed].join(", ") + "). Check the plate view and retry.";
        throw new Error(server.conflictMessage);
      }
      if (second.capturedAt <= first.capturedAt || (server.lastVerifiedTime && first.capturedAt <= server.lastVerifiedTime))
        throw new Error("Camera returned a repeated or out-of-order capture. Retry with fresh images.");
      if (Date.now() - started >= 30000) throw new Error("Verification expired. Request a fresh capture.");
      server.lastVerifiedTime = second.capturedAt;
      server.cameraLogin = login;
      server.loginOwner = owner;
      cameraReadings[role] = {value:second.value, at:started, verifiedId:crypto.randomUUID(), verifiedUntil:started + 30000};
      cameraConflicts[role] = false;
      cameraActivity[role] = "Verified by two direct camera captures.";
    } catch (error) {
      if (cameraServers[role] === server && cameraCycle === cycle) {
        cameraActivity[role] = error.message;
        if (/authenticat|HTTP 401/i.test(error.message)) delete server.cameraLogin;
        cameraConflicts[role] = previousConflict || verification.observed.size > 1;
      }
      throw error;
    } finally {
      server.verification = null;
      emitCamera(cameraState());
    }
    return cameraState();
  });
  ipcMain.handle("camera:disconnect", (_event, role = "front") => {
    if (!["front", "rear"].includes(role)) throw new Error("Invalid camera role.");
    cameraGeneration[role]++;
    if (cameraServers[role]) cameraServers[role].close();
    cameraServers[role] = null; clearCameraCycle(); return cameraState();
  });
  ipcMain.handle("container:connect", async (_event, options) => {
    const generation = ++containerGeneration;
    const ip = String(options.ip || "").trim();
    if (["front", "rear"].some((role) => cameraServers[role]?.cameraIp === ip || cameraConnecting[role]?.ip === ip)) throw new Error("The container camera must use its own IP address.");
    if (cameraServers.container) await cameraServers.container.close();
    if (generation !== containerGeneration) throw new Error("Container camera connection was cancelled.");
    cameraServers.container = null; clearCameraCycle(); containerStatus = "Starting local OCR"; emitCamera(cameraState());
    let reader;
    reader = await createContainerReader({ ip, port: Number(options.port), username: String(options.username || ""), password: String(options.password || "") }, {
      onStatus: ({ connected, status, ambiguous, clearReading }) => {
        if (cameraServers.container !== reader) return;
        containerStatus = status;
        if (ambiguous) { cameraReadings.container = null; cameraConflicts.container = true; }
        if (!connected || clearReading) cameraReadings.container = null;
        emitCamera(cameraState());
      },
      onCode: (value, observedAt) => {
        if (cameraServers.container !== reader || cycleConsumed) return;
        const previous = lastContainerReading;
        if (previous && Date.now() - previous.at < 30000 && previous.value !== value) cameraConflicts.container = true;
        else if (!cameraConflicts.container && Number.isFinite(observedAt)) { cameraReadings.container = { value, at: observedAt }; lastContainerReading = cameraReadings.container; }
        emitCamera(cameraState());
      }
    });
    if (generation !== containerGeneration) { await reader.close(); throw new Error("Container camera connection was cancelled."); }
    rememberCamera("container", { ip, port: Number(options.port), username: String(options.username || "") });
    cameraServers.container = reader; emitCamera(cameraState()); return cameraState();
  });
  ipcMain.handle("container:disconnect", async () => {
    containerGeneration++;
    const reader = cameraServers.container; cameraServers.container = null;
    if (reader) await reader.close();
    containerStatus = "Container camera stopped"; clearCameraCycle(); return cameraState();
  });
  ipcMain.handle("camera:state", () => cameraState());
  ipcMain.handle("serial:list", async () => {
    try {
      const { SerialPort } = require("serialport");
      return await SerialPort.list();
    } catch (error) {
      throw new Error(`Unable to scan COM ports: ${error.message}`);
    }
  });
  ipcMain.handle("serial:connect", () => connectSerial(loadState().settings.serial));
  ipcMain.handle("serial:disconnect", () => {
    stopConnections();
    return { connected: false };
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
app.whenReady().then(() => {
  setInterval(() => {
    if (latestScaleReading && Date.now() - Date.parse(latestScaleReading.receivedAt) > 3000) {
      latestScaleReading = null; stableSamples = []; clearCameraCycle();
      emitScale({ invalid: true, value: null, stable: false });
    }
  }, 500);
  registerHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopConnections();
  for (const server of Object.values(cameraServers)) if (server) server.close();
  if (process.platform !== "darwin") app.quit();
});

}
