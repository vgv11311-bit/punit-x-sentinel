"use strict";

const appState = {
  data: null,
  view: "dashboard",
  selectedPendingId: null,
  fieldRefreshBusy: false,
  savingGross: false,
  capture: {status:"idle"},
  capturingGross: false,
  standardConfirmed: false,
  savingTare: false,
  version: "",
  camera: { listening: false, plate: "", conflict: false },
  gross: { mode: "Live", reading: null, stable: false, captured: null, connected: false, status: "Disconnected", fields: {} },
  tare: { mode: "Live", reading: null, stable: false, captured: null, connected: false, status: "Disconnected" }
};

let captureStatusEpoch = 0;
let plateAttempt = 0;
let displayedPlateIds = {};

function resetPlatePreview() {
  plateAttempt++;
  displayedPlateIds = {};
}

function grossCameraValue(role) {
  const frozen = appState.capture.snapshot?.cameras?.[role];
  if (frozen) return frozen.value;
  const reading = appState.camera[role];
  if (role !== "container" && plateOnlyRoles().length) {
    return displayedPlateIds[role] && reading?.verifiedId === displayedPlateIds[role] && !reading.conflict ? reading.value : "";
  }
  return role === "front" ? appState.camera.plate || "" : reading?.value || "";
}
const titles = { dashboard: "Overview", gross: "Gross Weighment", tare: "Tare Weighment", completed: "Completed Records", settings: "Camera & Scale" };
const content = document.getElementById("content");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function formatWeight(value) {
  if (value === null || value === undefined || value === "") return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value));
}

function formatDate(value, withTime = true) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", withTime ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function toast(title, message, type = "success") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.innerHTML = `<div>${type === "success" ? "✓" : "!"}</div><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>`;
  document.getElementById("toastRegion").appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

function recordsByStatus(status) {
  return appState.data.records.filter((record) => record.status === status);
}

function setView(view) {
  if (view !== appState.view) resetPlatePreview();
  appState.view = view;
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  document.getElementById("pageTitle").textContent = titles[view];
  render();
}

function syncChrome() {
  const authenticated = Boolean(appState.data.auth?.authenticated);
  document.getElementById("operatorName").textContent = authenticated ? appState.data.currentUser.name : "Not signed in";
  document.getElementById("operatorRole").textContent = authenticated ? appState.data.currentUser.role : "Live API disconnected";
  document.getElementById("pendingBadge").textContent = recordsByStatus("TARE_PENDING").length;
  document.getElementById("newGrossButton").hidden = !authenticated;
  const syncCard = document.querySelector(".sync-card");
  if (syncCard) syncCard.innerHTML = authenticated
    ? `<span class="status-dot"></span><div><strong>Live API connected</strong><span>${escapeHtml(appState.data.auth.email || "Authenticated")}</span></div>`
    : `<span class="status-dot offline"></span><div><strong>API sign-in required</strong><span>sentinel.puniterp.com</span></div>`;
}

function renderLogin() {
  document.getElementById("pageTitle").textContent = "API Sign In";
  content.innerHTML = `<div class="login-layout"><div class="login-copy"><span class="login-kicker">SENTINEL LIVE</span><h2>Connect the weighbridge to your web data</h2><p>Sign in to download dynamic fields, settings, pending weighments, and completed records. Tare updates are sent directly to the live API.</p><ul><li>Encrypted Bearer-token storage</li><li>Password is used only for sign-in and is never saved</li><li>Automatic field and record refresh</li></ul></div><form id="loginForm" class="card login-card"><div class="card-header"><div><h3>Operator sign in</h3><p>Use your Sentinel web application credentials</p></div></div><div class="field"><label>Email address</label><input id="loginEmail" class="input" type="email" value="sentinel@gmail.com" autocomplete="username" required></div><div class="field" style="margin-top:13px"><label>Password</label><input id="loginPassword" class="input" type="password" autocomplete="current-password" placeholder="Enter your password" required></div><div id="loginError" class="field-error" style="margin-top:7px"></div><button class="button primary" type="submit" style="width:100%;margin-top:9px">Sign in to live API</button><div class="api-address">https://sentinel.puniterp.com/api/v1</div></form></div>`;
}

function recordRows(records, showStatus = true, showReport = false) {
  return records.map((record) => `
    <tr>
      <td><strong>${escapeHtml(record.weighmentNumber)}</strong><br><span class="operator">${formatDate(record.createdAt)}</span></td>
      <td><span class="plate">${escapeHtml(record.fields.vehiclePlate)}</span><br><span class="operator">${escapeHtml(record.fields.driverName || "—")}</span></td>
      <td>${escapeHtml(record.fields.material || "—")}</td>
      <td class="weight">${formatWeight(record.gross?.weight)} <span class="operator">${escapeHtml(appState.data.config.weightUnit)}</span></td>
      <td class="weight">${formatWeight(record.tare?.weight)} <span class="operator">${record.tare ? escapeHtml(appState.data.config.weightUnit) : ""}</span></td>
      <td class="weight">${formatWeight(record.netWeight)} <span class="operator">${record.netWeight !== null ? escapeHtml(appState.data.config.weightUnit) : ""}</span></td>
      ${showStatus ? `<td><span class="badge ${record.status === "COMPLETED" ? "complete" : "pending"}">${record.status === "COMPLETED" ? "Completed" : "Tare Pending"}</span></td>` : ""}
      ${showReport ? `<td><button class="button primary small" data-report-id="${escapeHtml(record.id)}" ${record.serverId ? '' : 'disabled'}>Download report</button></td>` : ''}
    </tr>`).join("");
}

function renderDashboard() {
  const pending = recordsByStatus("TARE_PENDING");
  const completed = recordsByStatus("COMPLETED");
  const today = new Date().toDateString();
  const todayRecords = appState.data.records.filter((record) => new Date(record.createdAt).toDateString() === today);
  const totalNet = completed.reduce((sum, record) => sum + Number(record.netWeight || 0), 0);
  content.innerHTML = `
    <div class="page-lead"><div><h2>Weighment activity</h2><p>Monitor today's vehicle movement and continue pending tare operations.</p></div><span class="badge pending">Overview</span></div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-icon blue">#</div><div><span>Today's weighments</span><strong>${todayRecords.length}</strong></div></div>
      <div class="stat-card"><div class="stat-icon amber">T</div><div><span>Awaiting tare</span><strong>${pending.length}</strong></div></div>
      <div class="stat-card"><div class="stat-icon teal">✓</div><div><span>Completed</span><strong>${completed.length}</strong></div></div>
      <div class="stat-card"><div class="stat-icon navy">KG</div><div><span>Total net weight</span><strong>${formatWeight(totalNet)}</strong></div></div>
    </div>
    <div class="dashboard-grid">
      <div class="card flush">
        <div class="card-header" style="padding:18px 18px 0"><div><h3>Recent weighments</h3><p>Latest saved records across gross and tare operations</p></div><button class="button small" data-go="completed">View all</button></div>
        <div class="table-wrap"><table><thead><tr><th>Weighment</th><th>Vehicle / Driver</th><th>Material</th><th>Gross</th><th>Tare</th><th>Net</th><th>Status</th></tr></thead><tbody>${recordRows(appState.data.records.slice(0, 6)) || `<tr><td colspan="7">No records yet.</td></tr>`}</tbody></table></div>
      </div>
      <div class="card"><div class="card-header"><div><h3>Quick actions</h3><p>Start the next operator task</p></div></div><div class="quick-actions">
        <button class="quick-action" data-go="gross"><span class="qa-icon">G</span><div><strong>New gross weighment</strong><span>Create a vehicle entry and capture gross weight</span></div></button>
        <button class="quick-action" data-go="tare"><span class="qa-icon">T</span><div><strong>Complete a tare</strong><span>${pending.length} pending record${pending.length === 1 ? "" : "s"} ready for selection</span></div></button>
        <button class="quick-action" data-go="settings"><span class="qa-icon">⚙</span><div><strong>Scale configuration</strong><span>${escapeHtml(appState.data.settings.serial.path)} at ${escapeHtml(appState.data.settings.serial.baudRate)} baud</span></div></button>
      </div></div>
    </div>`;
}

function isPlateField(field) {
  const canonical = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const names = ["vehicleplate", "vehicleplatenumber", "vehiclenumber", "truckplateno", "registrationnumber"];
  return names.includes(canonical(field.key)) || names.includes(canonical(field.label));
}

function fieldControl(field, value = "", readOnly = false) {
  const id = `field-${field.key}`;
  const required = field.required ? `<span class="required">*</span>` : "";
  let control;
  if (["trailer_no", "container_no"].includes(field.key) && !readOnly) {
    const role = field.key === "trailer_no" ? "rear" : "container";
    control = `<input class="input" id="${id}" data-camera-role="${role}" data-field="${escapeHtml(field.key)}" value="${escapeHtml(grossCameraValue(role))}" placeholder="Waiting for ${role === "rear" ? "rear camera" : "container recognition"}" readonly>`;
  }
  else if (isPlateField(field) && !readOnly) control = `<input class="input" id="${id}" data-camera-plate data-field="${escapeHtml(field.key)}" value="${escapeHtml(grossCameraValue("front"))}" placeholder="Waiting for ANPR camera" readonly>`;
  else if (readOnly) control = `<input class="input" id="${id}" value="${escapeHtml(value)}" readonly>`;
  else if (field.type === "dropdown") control = `<select id="${id}" data-field="${escapeHtml(field.key)}"><option value="">Select ${escapeHtml(field.label)}</option>${(field.options || []).map((option) => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
  else if (field.type === "checkbox") control = `<label class="checkbox"><input id="${id}" data-field="${escapeHtml(field.key)}" type="checkbox" ${value ? "checked" : ""}> Yes</label>`;
  else control = `<input class="input" id="${id}" data-field="${escapeHtml(field.key)}" type="${field.type === "number" ? "number" : field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : "text"}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || `Enter ${field.label.toLowerCase()}`)}">`;
  return `<div class="field"><label for="${id}">${escapeHtml(field.label)} ${required}</label>${control}<div class="field-error" data-error="${escapeHtml(field.key)}"></div></div>`;
}

function weightPanel(context, title) {
  const weigh = appState[context];
  return `<div class="weigh-panel" data-context="${context}">
    <div class="card-header"><div><h3>${escapeHtml(title)}</h3><p>Weight is supplied automatically by the connected scale</p></div><span class="badge ${weigh.connected ? "live" : "pending"}">${weigh.connected ? "PORT OPEN" : "NOT CONNECTED"}</span></div>
    <div class="connection-line"><span class="connection-state ${weigh.connected ? "connected" : ""}"><i></i>${escapeHtml(weigh.status)}</span><button class="button ghost small" data-action="connect-scale">${weigh.connected ? "Reconnect" : "Connect scale"}</button></div>
    <div class="scale-display"><div class="scale-label">Current scale reading · ${escapeHtml(appState.data.config.weightUnit)}</div><div class="scale-value">${formatWeight(weigh.reading?.value)}<span>${escapeHtml(appState.data.config.weightUnit)}</span></div><div class="stable-indicator ${weigh.stable ? "stable" : ""}">${weigh.stable ? "● Stable reading" : "○ Waiting for stable reading"}</div></div>
    <div class="capture-summary"><span>Weight for this entry</span><strong>${weigh.captured ? `${formatWeight(weigh.captured)} ${escapeHtml(appState.data.config.weightUnit)}` : "Waiting for scale"}</strong></div>
    ${context === "gross" ? `<div class="capture-controls">
      <p>Keep only this truck on the bridge. Check the front plate, rear plate and container number before capture.</p>
      <label class="checkbox"><input id="confirmTruck" type="checkbox" ${appState.standardConfirmed ? "checked" : ""}> All three identifiers belong to this truck</label>
      <button class="button primary" data-action="capture-gross" ${appState.capturingGross || appState.capture.status === "retry" ? "disabled" : ""}>${appState.capturingGross ? "Capturing…" : "Capture truck & weight"}</button>
      <p id="captureStatus" role="status">${appState.capture.status === "retry" ? "Save outcome pending. Retry sends the original data, even after a restart. Do not create a replacement entry." : appState.capture.status === "captured" ? "Snapshot ready. Save within 30 seconds while the truck remains on the scale." : "Press Capture after all devices have supplied valid readings."}</p>
    </div>` : ""}
    <p class="scale-note">Camera: <strong class="camera-live">${escapeHtml(appState.camera.conflict ? "Plate unverified. Request a fresh plate in Camera & Scale." : (context === "gross" && plateOnlyRoles().length ? grossCameraValue("front") || "Awaiting fresh capture" : appState.camera.plate || (appState.camera.listening ? "Waiting for plate" : "Listener stopped")))}</strong><br>Check the vehicle and reading before saving.</p>
  </div>`;
}

function renderGross() {
  const fields = [...appState.data.config.fields].filter((field) => field.active !== false).sort((a, b) => a.order - b.order);
  content.innerHTML = `
    <div class="page-lead"><div><h2>Create gross entry</h2><p>Complete the vehicle details, capture a stable weight, and save the record for tare.</p></div><span class="badge pending">Step 1 of 2</span></div>
    <div class="split-layout">
      <div class="card"><div class="section-title"><span class="section-number">1</span><h3>Vehicle and consignment details</h3></div><div id="grossForm" class="form-grid">${fields.map((field) => fieldControl(field, appState.gross.fields?.[field.key] ?? "")).join("")}</div>
        <div style="display:flex;justify-content:flex-end;gap:9px;margin-top:20px;padding-top:16px;border-top:1px solid var(--line)"><button class="button" data-action="clear-gross">Clear form</button><button class="button success" data-action="save-gross" ${["captured","retry"].includes(appState.capture.status) && !appState.savingGross && appState.capture.sameOperator !== false ? "" : "disabled"}>${appState.capture.status === "retry" ? "Retry pending save" : "Save Gross"}</button></div>
      </div>${weightPanel("gross", "Gross weight capture")}
    </div>`;
}

function pendingItem(record) {
  return `<button class="pending-item ${appState.selectedPendingId === record.id ? "active" : ""}" data-pending-id="${escapeHtml(record.id)}"><div class="row"><span class="plate">${escapeHtml(record.fields.vehiclePlate)}</span><span class="weight">${formatWeight(record.gross.weight)} KG</span></div><strong>${escapeHtml(record.weighmentNumber)}</strong><p>${escapeHtml(record.fields.material || "—")} · ${formatDate(record.gross.capturedAt)}</p></button>`;
}

function renderTare() {
  const pending = recordsByStatus("TARE_PENDING");
  const selected = pending.find((record) => record.id === appState.selectedPendingId);
  content.innerHTML = `
    <div class="page-lead"><div><h2>Complete tare weighment</h2><p>Select a pending gross record, verify the vehicle, and capture its tare weight.</p></div><span class="badge pending">${pending.length} pending</span></div>
    <div class="pending-layout">
      <div class="card"><div class="card-header"><div><h3>Pending gross records</h3><p>Saved gross weight with no tare reading</p></div></div><div class="search-box"><span>⌕</span><input id="pendingSearch" class="input" placeholder="Search plate or weighment number"></div><div id="pendingList" class="pending-list">${pending.map(pendingItem).join("") || `<div class="empty-state"><div class="empty-icon">✓</div><h3>All caught up</h3><p>No records are waiting for tare.</p></div>`}</div></div>
      <div>${selected ? renderSelectedTare(selected) : `<div class="card empty-state"><div class="empty-icon">T</div><h3>Select a pending record</h3><p>Choose the vehicle currently on the scale. Its gross details will remain read only while you capture tare.</p></div>`}</div>
    </div>`;
}

function renderSelectedTare(record) {
  const details = appState.data.config.fields.filter((field) => field.active !== false).map((field) => `<div class="detail"><span>${escapeHtml(field.label)}</span><strong>${escapeHtml(record.fields[field.key] ?? "—")}</strong></div>`).join("");
  const preview = appState.tare.captured ? Math.max(0, Number(record.gross.weight) - Number(appState.tare.captured)) : null;
  return `<div class="card"><div class="record-banner"><div><span>Selected weighment</span><strong>${escapeHtml(record.weighmentNumber)}</strong></div><div style="text-align:right"><span>Gross weight</span><strong>${formatWeight(record.gross.weight)} ${escapeHtml(appState.data.config.weightUnit)}</strong></div></div><div class="details-grid">${details}</div>
    <div class="tare-workspace"><div><div class="section-title"><span class="section-number">2</span><h3>Tare and net calculation</h3></div><p style="color:var(--muted);font-size:11px;line-height:1.7">Verify that <strong>${escapeHtml(record.fields.vehiclePlate)}</strong> is on the scale. The record details above are locked to prevent accidental changes.</p>
      <div class="net-preview"><div class="net-block"><span>Gross</span><strong>${formatWeight(record.gross.weight)} KG</strong></div><b>−</b><div class="net-block"><span>Tare</span><strong>${formatWeight(appState.tare.captured)} KG</strong></div><b>=</b><div class="net-block result"><span>Net preview</span><strong>${formatWeight(preview)} KG</strong></div></div>
      <button class="button success" data-action="save-tare" style="width:100%;margin-top:14px" ${appState.tare.captured && appState.camera.plate && appState.camera.plate.replace(/\s/g, "") === String(record.fields.vehiclePlate).replace(/\s/g, "").toUpperCase() ? "" : "disabled"}>Save Tare & Complete</button></div>${weightPanel("tare", "Tare weight capture")}</div>
  </div>`;
}

function renderCompleted() {
  const completed = recordsByStatus("COMPLETED");
  content.innerHTML = `<div class="page-lead"><div><h2>Completed weighments</h2><p>Final gross, tare, and net values. Download a report using your account password.</p></div><span class="badge complete">${completed.length} completed</span></div>
    <div class="card flush"><div class="toolbar" style="padding:16px 16px 0"><div class="search-box"><span>⌕</span><input id="completedSearch" class="input" placeholder="Search vehicle, item, or weighment"></div><div class="filters"><select id="sourceFilter"><option value="">All sources</option><option>Live</option><option>Manual</option></select></div></div>
      <div class="table-wrap"><table><thead><tr><th>Weighment</th><th>Vehicle / Driver</th><th>Material</th><th>Gross</th><th>Tare</th><th>Net</th><th>Status</th><th>Report</th></tr></thead><tbody id="completedRows">${recordRows(completed, true, true)}</tbody></table></div></div><dialog id="reportDialog"><form id="reportForm"><h3>Download report</h3><p>Enter your Sentinel account password.</p><label for="reportPassword">Password</label><input id="reportPassword" class="input" type="password" autocomplete="current-password" required><p id="reportError" class="field-error" role="alert"></p><div style="display:flex;gap:10px;margin-top:16px"><button type="button" class="button" data-report-cancel>Cancel</button><button type="submit" class="button primary">Download</button></div></form></dialog>`;
}

function directPlateControls(role) {
  return `<details><summary>Request a fresh plate</summary>
    <p>Keep one vehicle in view. Sentinel requests two readings directly from this camera.</p>
    <label>Camera HTTP port<input class="input" id="${role}HttpPort" type="number" value="80" min="1" max="65535"></label>
    <label>Camera username<input class="input" id="${role}CameraUser" autocomplete="off"></label>
    <label>Camera password<input class="input" id="${role}CameraPassword" type="password" autocomplete="off"></label>
    <button class="button" data-action="verify-plate" data-role="${role}">Read stationary plate</button></details>`;
}
function renderSettings() {
  const settings = appState.data.settings;
  const serial = settings.serial;
  const cameras = settings.cameras || {};
  content.innerHTML = `<div class="page-lead"><div><h2>App configuration</h2><p>Desktop v${escapeHtml(appState.version || "—")} · API data and shared colors refresh automatically.</p></div><button class="button" data-action="sync-now">Refresh API data</button></div>
    <div class="settings-grid">
      <div class="card"><div class="card-header"><div><h3>Live web synchronization</h3><p>Fields update automatically from the web every 5 seconds.</p></div><span class="badge live">Connected</span></div><div class="field"><label>API base URL</label><input class="input" value="${escapeHtml(settings.apiBaseUrl)}" readonly></div><div class="detail" style="margin-top:12px"><span>Signed in as</span><strong>${escapeHtml(appState.data.auth.email || appState.data.currentUser.name)}</strong></div><div class="detail" style="margin-top:9px"><span>Last successful refresh</span><strong>${formatDate(appState.data.auth.lastSync)}</strong></div>${appState.data.auth.error ? `<div class="sync-error">${escapeHtml(appState.data.auth.error)}</div>` : ""}<div style="display:flex;gap:8px;margin-top:14px"><button class="button primary" data-action="sync-now">Refresh now</button><button class="button danger" data-action="logout">Sign out</button></div></div>
      <div class="card"><div class="card-header"><div><h3>RS-232 scale</h3><p>Select the scale COM port and match the indicator settings. Check the indicator menu or manual: defaults are not detected automatically.</p></div></div><div class="inline-fields"><div class="field"><label>Device port</label><select id="serialPath"><option value="${escapeHtml(serial.path)}">${escapeHtml(serial.path)}</option></select></div><div class="field"><label>Baud rate</label><select id="baudRate">${[1200,2400,4800,9600,19200,38400,57600,115200].map((rate) => `<option ${Number(serial.baudRate) === rate ? "selected" : ""}>${rate}</option>`).join("")}</select></div><div class="field"><label>Parity</label><select id="parity">${["none","even","odd"].map((value) => `<option ${serial.parity === value ? "selected" : ""}>${value}</option>`).join("")}</select></div></div><div class="inline-fields" style="margin-top:12px"><div class="field"><label>Data bits</label><select id="dataBits"><option ${serial.dataBits === 7 ? "selected" : ""}>7</option><option ${serial.dataBits === 8 ? "selected" : ""}>8</option></select></div><div class="field"><label>Stop bits</label><select id="stopBits"><option ${serial.stopBits === 1 ? "selected" : ""}>1</option><option ${serial.stopBits === 2 ? "selected" : ""}>2</option></select></div><div class="field"><label>Line ending</label><select id="lineEnding"><option value="\\r\\n" ${serial.lineEnding === "\\r\\n" ? "selected" : ""}>CR + LF</option><option value="\\n" ${serial.lineEnding === "\\n" ? "selected" : ""}>LF</option><option value="\\r" ${serial.lineEnding === "\\r" ? "selected" : ""}>CR</option></select></div></div><div class="field" style="margin-top:12px"><label for="scaleSettingsPassword">Sentinel account password (required to save)</label><input class="input" id="scaleSettingsPassword" type="password" autocomplete="current-password"></div><p class="microcopy">Settings remain saved on this Windows user account. Internet access is required to verify your password.</p><button class="button primary" data-action="save-serial-settings" style="margin-top:14px">Save scale settings</button> <button class="button" data-action="refresh-ports">Refresh ports</button></div>
      <div class="card"><div class="card-header"><div><h3>Front ANPR camera</h3><p>Hikvision DS-TCG406-E · local ISAPI event listener</p></div></div><div class="field"><label for="cameraIp">Camera IPv4 address</label><input class="input" id="cameraIp" value="${escapeHtml(cameras.front?.ip || "")}" placeholder="e.g. 192.168.1.20"></div><div class="field" style="margin-top:12px"><label for="cameraPort">Listener port</label><input class="input" id="cameraPort" type="number" min="1024" max="65535" value="${escapeHtml(cameras.front?.port || 8031)}"></div><p class="microcopy">Configure the camera's HTTP notification host to this PC, the selected listener port and path /anpr. Recognition events supply plate text; images are discarded. The listener status does not prove that the camera is sending events.</p><button class="button primary" data-action="connect-camera">Start camera listener</button><button class="button" data-action="disconnect-camera">Stop listener</button><p id="cameraStatus" class="microcopy">${appState.camera.listening ? escapeHtml(appState.camera.status || "Listener active · waiting for camera events") : "Camera listener stopped"}</p>${directPlateControls("front")}</div>
      <div class="card"><div class="card-header"><div><h3>Rear ANPR camera</h3><p>Configure the camera for the rear/trailer plate.</p></div></div><div class="field"><label for="rearCameraIp">Camera IPv4 address</label><input class="input" id="rearCameraIp" value="${escapeHtml(cameras.rear?.ip || "")}" placeholder="e.g. 192.168.1.21"></div><div class="field" style="margin-top:12px"><label for="rearCameraPort">Listener port</label><input class="input" id="rearCameraPort" type="number" min="1024" max="65535" value="${escapeHtml(cameras.rear?.port || 8032)}"></div><p class="microcopy">Set this camera's HTTP notification host to this PC and the selected port, with path /anpr.</p><button class="button primary" data-action="connect-rear-camera">Start rear listener</button><button class="button" data-action="disconnect-rear-camera">Stop listener</button><p id="rearCameraStatus" class="microcopy">${appState.camera.rear?.listening ? escapeHtml(appState.camera.rear?.status || "Listener active · waiting for camera events") : "Rear camera listener stopped"}</p>${directPlateControls("rear")}</div>
      <div class="card"><div class="card-header"><div><h3>Container number camera</h3><p>Hikvision snapshot · local container OCR</p></div></div><div class="inline-fields"><div class="field"><label for="containerIp">Camera IPv4 address</label><input class="input" id="containerIp" value="${escapeHtml(cameras.container?.ip || "")}" placeholder="e.g. 192.168.1.22"></div><div class="field"><label for="containerPort">HTTP port</label><input class="input" id="containerPort" type="number" min="1" max="65535" value="${escapeHtml(cameras.container?.port || 80)}"></div></div><div class="inline-fields" style="margin-top:12px"><div class="field"><label for="containerUser">Camera username</label><input class="input" id="containerUser" value="${escapeHtml(cameras.container?.username || "")}" autocomplete="off"></div><div class="field"><label for="containerPassword">Camera password</label><input class="input" id="containerPassword" type="password" autocomplete="new-password"></div></div><p class="microcopy">Credentials stay in memory for this session. OCR runs locally; images are not saved or uploaded. Use a trusted camera network.</p><button class="button primary" data-action="connect-container">Start container OCR</button><button class="button" data-action="disconnect-container">Stop</button><p id="containerStatus" class="microcopy">${escapeHtml(appState.camera.container?.status || "Container camera stopped")}</p></div>
      <div class="card wide"><div class="card-header"><div><h3>Local data storage</h3><p>Records are written atomically to this application data file.</p></div></div><div class="data-path">${escapeHtml(appState.data.dataFile)}</div></div>
    </div>`;
  populatePorts();
}

async function populatePorts() {
  const select = document.getElementById("serialPath");
  if (!select) return;
  try {
    const ports = await window.sentinel.listPorts();
    const current = appState.data.settings.serial.path;
    select.innerHTML = `<option value="">${ports.length ? "Select a COM port" : "No COM ports detected"}</option>` + ports.map((port) => `<option value="${escapeHtml(port.path)}" ${port.path === current ? "selected" : ""}>${escapeHtml(port.path)}${port.manufacturer ? ` — ${escapeHtml(port.manufacturer)}` : ""}</option>`).join("");
  } catch (error) { toast("Port scan failed", error.message, "error"); }
}

function render() {
  syncChrome();
  if (!appState.data.auth?.authenticated) { renderLogin(); return; }
  if (appState.view === "dashboard") renderDashboard();
  if (appState.view === "gross") renderGross();
  if (appState.view === "tare") renderTare();
  if (appState.view === "completed") renderCompleted();
  if (appState.view === "settings") renderSettings();
}

async function refreshSharedPalette() {
  try {
    const theme = await window.sentinel.getTheme();
    if (theme) for (const key of ["background", "surface", "accent"]) document.documentElement.style.setProperty(`--shared-${key}`, theme[key]);
  } catch (_) { /* Keep the bundled palette if offline. */ }
}

async function refreshFieldsAutomatically() {
  if (!appState.data?.auth?.authenticated || appState.fieldRefreshBusy) return;
  appState.fieldRefreshBusy = true;
  try {
    const result = await window.sentinel.refreshFields();
    if (result.accessDenied) { appState.data=result.state; appState.gross.fields={}; appState.capture={status:'idle'}; appState.selectedPendingId=null; render(); toast('Access ended','Your account is disabled, expired, or needs sign-in.','error'); return; }
    if (result.changed) {
      appState.data.config.fields = result.fields;
      appState.data.config.lastUpdated = result.lastUpdated;
      if (appState.view === "gross") renderGross();
      toast("Web fields updated", "The latest field configuration is now available in the Gross form.");
    }
  } catch (_error) {
    // A manual refresh displays connection errors; background polling remains quiet.
  } finally {
    appState.fieldRefreshBusy = false;
  }
}

function weightContextFrom(target) {
  return target.closest("[data-context]")?.dataset.context;
}

async function connectScale(context) {
  const weigh = appState[context];
  weigh.status = "Connecting";
  render();
  try {
    const result = await window.sentinel.connectSerial({ ...appState.data.settings.serial });
    for (const item of [appState.gross, appState.tare]) { item.connected = true; item.status = result.simulated ? "Simulator connected" : `${result.path} open · waiting for valid data`; item.captured = null; item.stable = false; item.reading = null; }
    toast("Port opened", `Waiting for valid scale data on ${result.path}.`);
  } catch (error) {
    for (const item of [appState.gross, appState.tare]) { item.connected = false; item.status = "Connection failed"; item.reading = null; item.stable = false; item.captured = null; }
    toast("Scale connection failed", error.message, "error");
  }
  render();
}

function plateOnlyRoles() {
  if (appState.capture.status === "retry" || appState.capture.status === "captured") return [];
  const roles = ["front","rear"].filter(role => appState.camera[role]?.listening);
  const full = roles.length === 2 && roles.every(role => appState.camera[role].value && !appState.camera[role].conflict) && appState.camera.container?.listening && appState.gross.connected && appState.gross.stable && appState.gross.reading?.value > 0;
  return full ? [] : roles;
}

function askCameraLogin(role) {
  return new Promise(resolve => {
    const dialog = document.createElement("dialog");
    dialog.innerHTML = `<form method="dialog"><h3>Read ${role} plate</h3><p>Enter the camera login to capture this stationary vehicle. Sentinel keeps it in memory for this session.</p>
      <label>Camera HTTP port<input class="input" name="port" type="number" min="1" max="65535" value="80" required></label>
      <label>Camera username<input class="input" name="username" autocomplete="off" required></label>
      <label>Camera password<input class="input" name="password" type="password" autocomplete="off" required></label>
      <button type="button" class="button">Cancel</button> <button class="button primary" value="read">Read plate</button></form>`;
    document.body.append(dialog);
    dialog.querySelector('[type="button"]').onclick = () => dialog.close();
    dialog.addEventListener("close", () => {
      const data = new FormData(dialog.querySelector("form"));
      dialog.remove();
      resolve(dialog.returnValue === "read" ? {httpPort:Number(data.get("port")),username:data.get("username"),password:data.get("password")} : null);
    }, {once:true});
    dialog.showModal();
  });
}

async function capturePlatesOnly(roles, attempt) {
  const ids = {};
  appState.capturingGross = true;
  refreshScaleDom("gross");
  try {
    for (const role of roles) {
      const current = (await window.sentinel.cameraState())[role];
      if (!current?.listening) throw new Error("The " + role + " camera listener stopped.");
      const login = current.directReady ? {} : await askCameraLogin(role);
      if (!login || appState.view !== "gross" || attempt !== plateAttempt) return;
      const result = await window.sentinel.verifyPlate({role,ip:current.ip,...login,afterTap:true});
      if (attempt !== plateAttempt) return;
      ids[role] = result[role]?.verifiedId;
    }
    const latest = await window.sentinel.cameraState();
    if (attempt !== plateAttempt) return;
    if (roles.some(role => !ids[role] || latest[role]?.verifiedId !== ids[role] || latest[role].conflict || !latest[role].value))
      throw new Error("A plate changed or expired. Capture again.");
    displayedPlateIds = ids;
    updateCameraStatus(latest);
    toast("Plate capture ready", roles.map(role => role + ": " + latest[role].value).join(" · "));
  } catch (error) { toast("Unable to read plate", error.message, "error"); }
  finally { appState.capturingGross = false; if (appState.view === "gross") refreshScaleDom("gross"); }
}

async function captureGross() {
  if (appState.capturingGross || appState.savingGross) return;
  resetPlatePreview();
  const attempt = plateAttempt;
  updateCameraStatus(appState.camera);
  appState.gross.fields = collectGrossFields();
  if (window.sentinel.cameraState) {
    try { updateCameraStatus(await window.sentinel.cameraState()); }
    catch (error) { return toast("Camera status unavailable", error.message, "error"); }
    if (attempt !== plateAttempt || appState.view !== "gross" || appState.capturingGross || appState.savingGross) return;
  }
  const roles = plateOnlyRoles();
  if (roles.length) return capturePlatesOnly(roles, attempt);
  if (!document.getElementById("confirmTruck")?.checked) return toast("Check this truck", "Confirm all three identifiers belong to the only truck on the bridge.", "error");
  captureStatusEpoch++; appState.capturingGross = true; renderGross();
  try {
    const snapshot = await window.sentinel.captureGross({confirmed:true,mode:"standard"});
    updateCaptureStatus({status:"captured",snapshot});
    toast("Capture ready", "Review the frozen details and save within 30 seconds.");
  } catch (error) { toast("Unable to capture", error.message, "error"); }
  finally { appState.capturingGross = false; renderGross(); }
}

function updateCaptureStatus(status) {
  const changed = JSON.stringify(appState.capture) !== JSON.stringify(status);
  appState.capture = status;
  appState.gross.captured = status.snapshot?.weightKg || null;
  if (changed && status.status === "idle") appState.standardConfirmed = false;
  if (changed && appState.data?.auth?.authenticated && appState.view === "gross") renderGross();
}

function captureWeight(context) {
  const weigh = appState[context];
  const value = weigh.mode === "Live" ? weigh.reading?.value : Number(weigh.manualValue);
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return toast("Invalid weight", "Enter or receive a weight greater than zero.", "error");
  if (weigh.mode === "Live" && !weigh.stable) return toast("Reading is not stable", "Wait for the stable indicator before capturing.", "error");
  weigh.captured = Number(value);
  toast("Weight captured", `${formatWeight(value)} ${appState.data.config.weightUnit} is ready to save.`);
  render();
}

function collectGrossFields() {
  const values = {};
  appState.data.config.fields.filter((field) => field.active !== false).forEach((field) => {
    const control = document.getElementById(`field-${field.key}`);
    values[field.key] = field.type === "checkbox" ? control.checked : control.value.trim();
  });
  return values;
}

function refreshScaleDom(context) {
  const panel = document.querySelector(`[data-context="${context}"]`);
  const weigh = appState[context];
  if (!panel || weigh.mode !== "Live") return;
  if (context === "gross") {
    const partial = plateOnlyRoles().length > 0;
    const capture = panel.querySelector('[data-action="capture-gross"]');
    capture.disabled = appState.capturingGross || appState.capture.status === "retry";
    capture.textContent = appState.capturingGross ? "Capturing…" : partial ? "Capture number plate" : "Capture truck & weight";
    panel.querySelector("#confirmTruck").parentElement.style.display = partial ? "none" : "";
    if (appState.capture.status === "idle") panel.querySelector("#captureStatus").textContent = partial
      ? "Plate capture is available. A complete weighment requires all three cameras and a stable scale reading."
      : "Check the identifiers and stable weight before capture.";
  }
  const valueNode = panel.querySelector(".scale-value");
  const stableNode = panel.querySelector(".stable-indicator");
  const connectionNode = panel.querySelector(".connection-state");
  const portBadge = panel.querySelector(".card-header .badge");
  if (portBadge) { portBadge.className = `badge ${weigh.connected ? "live" : "pending"}`; portBadge.textContent = weigh.connected ? "PORT OPEN" : "NOT CONNECTED"; }
  const captureButton = panel.querySelector('[data-action="capture-weight"]');
  if (valueNode) valueNode.innerHTML = `${formatWeight(weigh.reading?.value)}<span>${escapeHtml(appState.data.config.weightUnit)}</span>`;
  if (stableNode) {
    stableNode.classList.toggle("stable", weigh.stable);
    stableNode.textContent = weigh.stable ? "● Stable reading" : "○ Waiting for stable reading";
  }
  if (connectionNode) {
    connectionNode.classList.toggle("connected", weigh.connected);
    connectionNode.classList.toggle("connecting", weigh.status === "Connecting");
    connectionNode.innerHTML = `<i></i>${escapeHtml(weigh.status)}`;
  }
  const summary = panel.querySelector(".capture-summary strong");
  if (summary) summary.textContent = weigh.captured ? `${formatWeight(weigh.captured)} ${appState.data.config.weightUnit}` : "Waiting for scale";
  const save = document.querySelector(`[data-action="save-${context}"]`);
  if (save) {
    const selected = context === "tare" ? recordsByStatus("TARE_PENDING").find((item) => item.id === appState.selectedPendingId) : null;
    const matched = context !== "tare" || (selected && String(selected.fields.vehiclePlate).replace(/\s/g, "").toUpperCase() === String(appState.camera.plate).replace(/\s/g, "").toUpperCase());
    save.disabled = context === "gross" ? appState.savingGross || !["captured","retry"].includes(appState.capture.status) || appState.capture.sameOperator === false : appState.savingTare || !weigh.captured || !appState.camera.plate || !matched;
  }
  if (context === "tare") {
    const record = recordsByStatus("TARE_PENDING").find((item) => item.id === appState.selectedPendingId);
    const blocks = document.querySelectorAll(".net-preview .net-block strong");
    if (record && blocks.length === 3) { blocks[1].textContent = `${formatWeight(weigh.captured)} KG`; blocks[2].textContent = `${formatWeight(weigh.captured ? Math.max(0, record.gross.weight - weigh.captured) : null)} KG`; }
  }
}

function showValidation(errors) {
  document.querySelectorAll(".field-error").forEach((node) => { node.textContent = errors[node.dataset.error] || ""; });
  const first = Object.keys(errors)[0];
  if (first) document.getElementById(`field-${first}`)?.focus();
}

async function saveGross() {
  const weigh = appState.gross;
  if (!weigh.captured || appState.savingGross) return;
  captureStatusEpoch++; appState.savingGross = true;
  refreshScaleDom("gross");
  try {
    const result = await window.sentinel.saveGross({ fields: collectGrossFields(), captureId: appState.capture.snapshot?.id || appState.capture.id });
    if (result.validationErrors) return showValidation(result.validationErrors);
    if (result.duplicateVehicle) {
      return toast("Pending weighment exists", `${result.existing.fields.vehiclePlate} already has pending weighment ${result.existing.weighmentNumber}. Complete it before starting another.`, "error");
    }
    appState.data = result.state;
    toast("Gross saved to web", `${result.record.weighmentNumber} is synchronized and waiting for tare.`);
    appState.gross = { ...appState.gross, fields: {}, requestId: null, captured: null };
    appState.capture = {status:"idle"}; appState.standardConfirmed = false;
    setView("tare");
  } catch (error) { toast("Unable to save gross", `${error.message} Your entered data remains on screen.`, "error"); }
  finally { appState.savingGross = false; if (window.sentinel.captureStatus) updateCaptureStatus(await window.sentinel.captureStatus()); if (appState.view === "gross") refreshScaleDom("gross"); }
}

async function saveTare() {
  const record = appState.data.records.find((item) => item.id === appState.selectedPendingId);
  if (!record || !appState.tare.captured || appState.savingTare) return;
  if (Number(appState.tare.captured) > Number(record.gross.weight)) return toast("Invalid tare", "Tare weight cannot be greater than gross weight.", "error");
  appState.savingTare = true;
  refreshScaleDom("tare");
  try {
    const result = await window.sentinel.saveTare({ recordId: record.id, weight: appState.tare.captured, source: appState.tare.mode, reason: appState.tare.reason || "", requestId: crypto.randomUUID() });
    if (result.validationErrors) return showValidation(result.validationErrors);
    if (result.alreadyCompleted) { appState.data = await window.sentinel.getState(); toast("Already completed", "This weighment was completed by another operation. The record has been refreshed.", "error"); return setView("tare"); }
    appState.data = result.state;
    toast("Tare saved", `${result.record.weighmentNumber} completed with net weight ${formatWeight(result.record.netWeight)} ${appState.data.config.weightUnit}.`);
    appState.selectedPendingId = null;
    appState.tare = { ...appState.tare };
    setView("completed");
  } catch (error) { toast("Unable to save tare", `${error.message} Refresh the record before retrying.`, "error"); }
  finally { appState.savingTare = false; if (appState.view === "tare") refreshScaleDom("tare"); }
}

function updateCompletedFilter() {
  const query = document.getElementById("completedSearch")?.value.toLowerCase() || "";
  const source = document.getElementById("sourceFilter")?.value || "";
  const records = recordsByStatus("COMPLETED").filter((record) => {
    const haystack = `${record.weighmentNumber} ${record.fields.vehiclePlate} ${record.fields.driverName} ${record.fields.material}`.toLowerCase();
    return haystack.includes(query) && (!source || record.gross.source === source || record.tare.source === source);
  });
  document.getElementById("completedRows").innerHTML = recordRows(records, true, true) || `<tr><td colspan="8">No matching records.</td></tr>`;
}

function updatePendingFilter(query) {
  const lower = query.toLowerCase();
  document.getElementById("pendingList").innerHTML = recordsByStatus("TARE_PENDING").filter((record) => `${record.weighmentNumber} ${record.fields.vehiclePlate} ${record.fields.driverName} ${record.fields.material}`.toLowerCase().includes(lower)).map(pendingItem).join("") || `<div class="empty-state"><p>No matching pending records.</p></div>`;
}

content.addEventListener("input", (event) => {
  if (event.target.matches("[data-field]")) {
    const key = event.target.dataset.field;
    appState.gross.fields[key] = event.target.type === "checkbox" ? event.target.checked : event.target.value;
  }
  if (event.target.matches("[data-manual-weight]")) { const context = weightContextFrom(event.target); appState[context].manualValue = event.target.value; appState[context].captured = null; }
  if (event.target.matches("[data-manual-reason]")) { const context = weightContextFrom(event.target); appState[context].reason = event.target.value; }
  if (event.target.id === "pendingSearch") updatePendingFilter(event.target.value);
  if (event.target.id === "completedSearch") updateCompletedFilter();
});
content.addEventListener("change", (event) => { if (event.target.id === "sourceFilter") updateCompletedFilter(); });

content.addEventListener("submit", async (event) => {
  if (event.target.id === 'reportForm') {
    event.preventDefault(); const form=event.target, dialog=document.getElementById('reportDialog'), input=document.getElementById('reportPassword'), error=document.getElementById('reportError'), button=form.querySelector('[type=submit]');
    button.disabled=true; error.textContent='';
    try { const target=await window.sentinel.downloadReport(form.dataset.serverId, input.value); input.value=''; dialog.close(); toast('Report downloaded', `Saved to ${target}`); }
    catch (err) { error.textContent=err.message; input.value=''; input.focus(); }
    finally { button.disabled=false; }
    return;
  }
  if (event.target.id !== "loginForm") return;
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  const errorNode = document.getElementById("loginError");
  button.disabled = true;
  button.textContent = "Signing in…";
  errorNode.textContent = "";
  try {
    appState.data = await window.sentinel.login({ email: document.getElementById("loginEmail").value.trim(), password: document.getElementById("loginPassword").value });
    appState.view = "dashboard";
    toast("Connected to Sentinel", "Live fields, settings, and weighments have been downloaded.");
    render();
  } catch (error) {
    errorNode.textContent = error.message;
    button.disabled = false;
    button.textContent = "Sign in to live API";
  }
});

content.addEventListener("click", async (event) => {

  const report=event.target.closest('[data-report-id]');
  if(report) { const record=recordsByStatus('COMPLETED').find(item=>item.id===report.dataset.reportId); if(!record?.serverId)return; const dialog=document.getElementById('reportDialog'); document.getElementById('reportForm').dataset.serverId=record.serverId; document.getElementById('reportPassword').value=''; document.getElementById('reportError').textContent=''; dialog.showModal(); document.getElementById('reportPassword').focus(); return; }
  if(event.target.closest('[data-report-cancel]')) { document.getElementById('reportPassword').value=''; document.getElementById('reportDialog').close(); return; }

  const go = event.target.closest("[data-go]");
  if (go) return setView(go.dataset.go);
  const pending = event.target.closest("[data-pending-id]");
  if (pending) { appState.selectedPendingId = pending.dataset.pendingId; return render(); }
  const modeButton = event.target.closest("[data-weight-mode]");
  if (modeButton) { const context = weightContextFrom(modeButton); appState[context].mode = modeButton.dataset.weightMode; appState[context].captured = null; return render(); }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  const context = weightContextFrom(event.target);
  if (action === "verify-plate") {
    const button = event.target.closest("button");
    const role = button.dataset.role;
    const password = document.getElementById(role + "CameraPassword");
    const username = document.getElementById(role + "CameraUser").value;
    if (!username || !password.value) { toast("Camera login required", "Enter the camera username and password.", "error"); return; }
    button.disabled = true;
    try {
      const status = await window.sentinel.verifyPlate({role, username, password:password.value,
        ip:document.getElementById(role === "front" ? "cameraIp" : "rearCameraIp").value.trim(),
        httpPort:Number(document.getElementById(role + "HttpPort").value)});
      updateCameraStatus(status);
      toast("Plate verified", status[role].value);
    } catch (error) { toast("Camera verification failed", error.message, "error"); }
    finally { button.disabled = false; password.value = ""; }
    return;
  }
  if (action === "connect-camera") {
    try { const config = { ip: document.getElementById("cameraIp").value.trim(), port: Number(document.getElementById("cameraPort").value) }; appState.camera = await window.sentinel.connectCamera(config); (appState.data.settings.cameras ||= {}).front = config; toast("Listener started", "Configure the camera to send ANPR events to this PC."); renderSettings(); }
    catch (error) { toast("Camera listener failed", error.message, "error"); }
    return;
  }
  if (action === "disconnect-camera") { appState.camera = await window.sentinel.disconnectCamera("front"); renderSettings(); return; }
  if (action === "connect-rear-camera") {
    try { const config = { role: "rear", ip: document.getElementById("rearCameraIp").value.trim(), port: Number(document.getElementById("rearCameraPort").value) }; appState.camera = await window.sentinel.connectCamera(config); (appState.data.settings.cameras ||= {}).rear = { ip: config.ip, port: config.port }; toast("Rear listener started", "Configure the rear camera to send ANPR events to this PC."); renderSettings(); }
    catch (error) { toast("Rear camera listener failed", error.message, "error"); }
    return;
  }
  if (action === "disconnect-rear-camera") { appState.camera = await window.sentinel.disconnectCamera("rear"); renderSettings(); return; }
  if (action === "connect-container") {
    try {
      const button = event.target.closest("button"); button.disabled = true;
      const config = { ip: document.getElementById("containerIp").value.trim(), port: Number(document.getElementById("containerPort").value), username: document.getElementById("containerUser").value, password: document.getElementById("containerPassword").value };
      appState.camera = await window.sentinel.connectContainer(config);
      (appState.data.settings.cameras ||= {}).container = { ip: config.ip, port: config.port, username: config.username };
      toast("Container OCR started", "Waiting for the camera to send readable container markings."); renderSettings();
    } catch (error) { toast("Container OCR failed", error.message, "error"); renderSettings(); }
    return;
  }
  if (action === "disconnect-container") { appState.camera = await window.sentinel.disconnectContainer(); renderSettings(); return; }
  if (action === "refresh-ports") return populatePorts();
  if (action === "connect-scale") return connectScale(context);
  if (action === "capture-gross") return captureGross();
  if (action === "capture-weight") return captureWeight(context);
  if (action === "clear-weight") { appState[context] = { ...appState[context], captured: null, manualValue: "", reason: "" }; return render(); }
  if (action === "clear-gross") { resetPlatePreview(); captureStatusEpoch++; updateCaptureStatus(await window.sentinel.clearCapture()); appState.gross.fields = {}; appState.standardConfirmed = false; return renderGross(); }
  if (action === "save-gross") return saveGross();
  if (action === "save-tare") return saveTare();
  if (action === "sync-now") {
    const button = event.target.closest("button");
    button.disabled = true;
    refreshSharedPalette();
    try { appState.data = await window.sentinel.sync(); toast("API data refreshed", "Fields, settings, and weighments are up to date."); render(); }
    catch (error) { toast("API refresh failed", error.message, "error"); button.disabled = false; }
    return;
  }
  if (action === "logout") {
    appState.gross.fields = {}; appState.capture = {status:'idle'}; appState.selectedPendingId=null;
    appState.data = await window.sentinel.logout();
    appState.selectedPendingId = null;
    toast("Signed out", "The saved API token was removed from this computer.");
    return render();
  }
  if (action === "save-serial-settings") {
    if (!document.getElementById("serialPath").value) return toast("Select a COM port", "Connect the scale adapter and refresh the port list.", "error");
    const password = document.getElementById("scaleSettingsPassword").value;
    if (!password) return toast("Password required", "Enter your Sentinel account password to save scale settings.", "error");
    try {
      appState.data = await window.sentinel.updateSettings({ serial: { path: document.getElementById("serialPath").value, baudRate: Number(document.getElementById("baudRate").value), dataBits: Number(document.getElementById("dataBits").value), parity: document.getElementById("parity").value, stopBits: Number(document.getElementById("stopBits").value), lineEnding: document.getElementById("lineEnding").value } }, password);
      toast("Scale settings saved", `${appState.data.settings.serial.path} at ${appState.data.settings.serial.baudRate} baud. Reconnect the scale to apply changes.`); return renderSettings();
    } catch (error) { toast("Scale settings not saved", error.message, "error"); return; }
  }
});

document.addEventListener("change", (event) => { if (event.target.id === "confirmTruck") appState.standardConfirmed = event.target.checked; });

document.getElementById("navigation").addEventListener("click", (event) => { const button = event.target.closest("[data-view]"); if (button) setView(button.dataset.view); });
document.getElementById("newGrossButton").addEventListener("click", () => setView("gross"));

function updateCameraStatus(status) {
  appState.camera = status;
  appState.gross.fields.vehiclePlate = grossCameraValue("front");
  document.querySelectorAll("[data-camera-plate]").forEach((input) => { input.value = grossCameraValue("front"); appState.gross.fields[input.dataset.field] = input.value; });
  document.querySelectorAll("[data-camera-role]").forEach((input) => { const value = grossCameraValue(input.dataset.cameraRole); input.value = value; appState.gross.fields[input.dataset.field] = value; });
  const cameraLive = document.querySelector(".camera-live");
  const previewOnly = appState.view === "gross" && plateOnlyRoles().length > 0;
  if (cameraLive) cameraLive.textContent = status.conflict ? status.front?.conflictMessage || "Plate unverified. Request a fresh plate." : previewOnly ? grossCameraValue("front") || "Awaiting fresh capture" : status.plate || (status.listening ? status.status || "Waiting for plate" : "Listener stopped");
  const cameraStatus = document.getElementById("cameraStatus");
  if (cameraStatus) cameraStatus.textContent = status.conflict ? status.front?.conflictMessage || "Plate unverified. Keep one vehicle in view and request a fresh plate." : status.plate ? `Plate received: ${status.plate}` : status.listening ? status.status || "Listener active · waiting for camera events" : "Camera listener stopped";
  const containerStatus = document.getElementById("containerStatus");
  if (containerStatus) containerStatus.textContent = status.container?.conflict ? "Multiple container numbers detected. Clear the weighbridge." : status.container?.value ? `Container recognized: ${status.container.value}` : status.container?.status || "Container camera stopped";
  const rearStatus = document.getElementById("rearCameraStatus");
  if (rearStatus) rearStatus.textContent = status.rear?.conflict ? status.rear.conflictMessage || "Rear plate unverified. Keep one vehicle in view and request a fresh plate." : status.rear?.value ? `Rear plate received: ${status.rear.value}` : status.rear?.listening ? status.rear.status || "Listener active · waiting for camera events" : "Rear camera listener stopped";
  if (appState.data?.auth?.authenticated && (appState.view === "gross" || appState.view === "tare")) refreshScaleDom(appState.view);
}
window.sentinel.onCameraStatus(updateCameraStatus);
window.sentinel.onScaleReading((reading) => {
  for (const context of ["gross", "tare"]) {
    const weigh = appState[context];
    if (weigh.mode !== "Live" || !weigh.connected) continue;
    if (reading.disconnected || reading.error) { weigh.connected = false; weigh.status = reading.error || "Disconnected"; weigh.stable = false; weigh.reading = null; weigh.captured = null; }
    else if (reading.invalid) { weigh.stable = false; weigh.reading = null; weigh.captured = null; weigh.status = reading.status || "Waiting for valid scale data"; }
    else if (reading.value !== null) { weigh.reading = reading; weigh.stable = Boolean(reading.stable); weigh.captured = weigh.stable && Number(reading.value) > 0 ? Number(reading.value) : null; weigh.status = reading.mode === "simulator" ? "Simulator connected" : "Scale connected"; }
  }
  appState.gross.captured = appState.capture.snapshot?.weightKg || null;
  if (appState.view === "gross") refreshScaleDom("gross");
  if (appState.view === "tare") refreshScaleDom("tare");
});

setInterval(() => {
  window.sentinel.cameraState().then(updateCameraStatus).catch(() => {});
  if (window.sentinel.captureStatus && !appState.capturingGross && !appState.savingGross) { const epoch = captureStatusEpoch; window.sentinel.captureStatus().then(status => { if (epoch === captureStatusEpoch) updateCaptureStatus(status); }).catch(() => {}); }
  for (const context of ["gross", "tare"]) {
    const weigh = appState[context];
    if (weigh.reading && Date.now() - Date.parse(weigh.reading.receivedAt) > 3000) {
      weigh.reading = null; weigh.stable = false; weigh.captured = context === "gross" ? appState.capture.snapshot?.weightKg || null : null; weigh.status = "Waiting for scale data";
      if (appState.view === context) refreshScaleDom(context);
    }
  }
}, 500);

function updateClock() {
  const now = new Date();
  document.getElementById("clockDate").textContent = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(now);
  document.getElementById("clockTime").textContent = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
}

async function init() {
  try {
    appState.version = await window.sentinel.getVersion();
    appState.data = await window.sentinel.getState();
    if (window.sentinel.captureStatus) updateCaptureStatus(await window.sentinel.captureStatus());
    updateClock(); setInterval(updateClock, 1000); setInterval(refreshFieldsAutomatically, 5000); refreshSharedPalette(); setInterval(refreshSharedPalette, 60000); render();
  } catch (error) {
    content.innerHTML = `<div class="card empty-state"><div class="empty-icon">!</div><h3>Application could not start</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

init();
