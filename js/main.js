import { generateSchedule } from "./scheduler.js";

const CONFIG_STORAGE_KEY = "bde_staff_auto_config_v1";
const SB_SETTINGS_KEY = "bde_staff_auto_sb_v1";
const SB_PASSWORD_KEY = "bde_staff_auto_sb_pwd";

const state = {
  config: null,
  lastResult: null,
  seed: Date.now(),
  serverWritable: false
};

const els = {
  status: document.getElementById("persistence-status"),
  settingsForm: document.getElementById("settings-form"),
  eventName: document.getElementById("event-name"),
  startTime: document.getElementById("start-time"),
  endTime: document.getElementById("end-time"),
  slotDuration: document.getElementById("slot-duration"),
  bus1Arrival: document.getElementById("bus1-arrival"),
  bus2Arrival: document.getElementById("bus2-arrival"),
  busStaffCount: document.getElementById("bus-staff-count"),
  busBuffer: document.getElementById("bus-buffer"),
  bus1Select1: document.getElementById("bus1-select-1"),
  bus1Select2: document.getElementById("bus1-select-2"),
  bus2Select1: document.getElementById("bus2-select-1"),
  bus2Select2: document.getElementById("bus2-select-2"),
  generateHeaderBtn: document.getElementById("generate-header-btn"),
  rerollBtn: document.getElementById("reroll-btn"),
  exportCsvBtn: document.getElementById("export-csv-btn"),
  addMemberForm: document.getElementById("add-member-form"),
  newMemberName: document.getElementById("new-member-name"),
  membersList: document.getElementById("members-list"),
  membersCount: document.getElementById("members-count"),
  addRoleForm: document.getElementById("add-role-form"),
  newRoleName: document.getElementById("new-role-name"),
  newRoleCount: document.getElementById("new-role-count"),
  rolesList: document.getElementById("roles-list"),
  rolesCount: document.getElementById("roles-count"),
  diagnostics: document.getElementById("diagnostics-container"),
  busStrip: document.getElementById("bus-strip"),
  metricsBar: document.getElementById("metrics-bar"),
  scheduleSubtitle: document.getElementById("schedule-subtitle"),
  scheduleThead: document.getElementById("schedule-thead"),
  scheduleTbody: document.getElementById("schedule-tbody"),
  summaryGrid: document.getElementById("member-summary-grid"),
  syncDialog: document.getElementById("sync-dialog"),
  openSyncBtn: document.getElementById("open-sync-btn"),
  closeSyncBtn: document.getElementById("close-sync-btn"),
  downloadJsonBtn: document.getElementById("download-json-btn"),
  importJsonInput: document.getElementById("import-json-input"),
  publishBtn: document.getElementById("publish-btn"),
  sbForm: document.getElementById("sb-form"),
  sbUrl: document.getElementById("sb-url"),
  sbKey: document.getElementById("sb-key"),
  sbPassword: document.getElementById("sb-password"),
  sbFeedback: document.getElementById("sb-feedback"),
  sbReloadBtn: document.getElementById("sb-reload-btn")
};

function setStatus(text) {
  els.status.textContent = text;
}

function safeReadLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeWriteLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors in private browsing.
  }
}

async function fetchRepoConfig() {
  const res = await fetch(`./data/config.json?t=${Date.now()}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

async function persistConfig() {
  safeWriteLocal(CONFIG_STORAGE_KEY, state.config);

  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state.config)
      });
      if (res.ok) {
        state.serverWritable = true;
        setStatus("Sauvegarde dans data/config.json");
        return;
      }
    } catch {
      // Fallback to localStorage only.
    }
  }
  setStatus("Sauvegarde locale navigateur");
}

function populateSettingsForm() {
  const s = state.config.settings;
  els.eventName.value = s.eventName ?? "";
  els.startTime.value = s.startTime ?? "22:00";
  els.endTime.value = s.endTime ?? "04:00";
  els.slotDuration.value = s.slotDuration ?? 45;
  els.bus1Arrival.value = s.bus1Arrival ?? "22:30";
  els.bus2Arrival.value = s.bus2Arrival ?? "23:15";
  els.busStaffCount.value = s.busStaffCount ?? 2;
  els.busBuffer.value = s.busBufferMinutes ?? 0;
}

function syncSettingsFromForm() {
  state.config.settings = {
    ...state.config.settings,
    eventName: els.eventName.value.trim(),
    startTime: els.startTime.value,
    endTime: els.endTime.value,
    slotDuration: Number(els.slotDuration.value),
    bus1Arrival: els.bus1Arrival.value,
    bus2Arrival: els.bus2Arrival.value,
    busStaffCount: Number(els.busStaffCount.value),
    busBufferMinutes: Number(els.busBuffer.value)
  };
}

function populateBusSelectors() {
  const active = state.config.members.filter((m) => m.active !== false);
  const selectors = [els.bus1Select1, els.bus1Select2, els.bus2Select1, els.bus2Select2];

  for (const sel of selectors) {
    const previous = sel.value;
    sel.replaceChildren();
    const autoOpt = document.createElement("option");
    autoOpt.value = "";
    autoOpt.textContent = "Tirage automatique";
    sel.appendChild(autoOpt);

    for (const member of active) {
      const opt = document.createElement("option");
      opt.value = member.id;
      opt.textContent = member.name;
      sel.appendChild(opt);
    }

    if (previous && active.some((m) => m.id === previous)) {
      sel.value = previous;
    }
  }
}

function renderMembers() {
  const members = state.config.members;
  const activeCount = members.filter((m) => m.active !== false).length;
  els.membersCount.textContent = `${activeCount}/${members.length}`;
  els.membersList.replaceChildren();

  for (const member of members) {
    const li = document.createElement("li");
    li.className = "roster-item";

    const label = document.createElement("label");
    label.className = "roster-check";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = member.active !== false;
    checkbox.addEventListener("change", async () => {
      member.active = checkbox.checked;
      populateBusSelectors();
      renderMembers();
      await persistConfig();
      runAndRenderSchedule();
    });

    const span = document.createElement("span");
    span.textContent = member.name;

    label.append(checkbox, span);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-quiet btn-sm";
    removeBtn.textContent = "Retirer";
    removeBtn.setAttribute("aria-label", `Retirer ${member.name}`);
    removeBtn.addEventListener("click", async () => {
      state.config.members = state.config.members.filter((m) => m.id !== member.id);
      populateBusSelectors();
      renderMembers();
      await persistConfig();
      runAndRenderSchedule();
    });

    li.append(label, removeBtn);
    els.membersList.appendChild(li);
  }
}

function renderRoles() {
  const roles = state.config.roles;
  els.rolesCount.textContent = String(roles.length);
  els.rolesList.replaceChildren();

  for (const role of roles) {
    const li = document.createElement("li");
    li.className = "roster-item";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = role.name;
    nameSpan.style.flex = "1";
    nameSpan.style.fontWeight = "600";

    const countInput = document.createElement("input");
    countInput.type = "number";
    countInput.min = "1";
    countInput.max = "10";
    countInput.value = String(role.countPerSlot);
    countInput.className = "role-count-input";
    countInput.setAttribute("aria-label", `Places par creneau pour ${role.name}`);
    countInput.addEventListener("change", async () => {
      const next = Math.max(1, Math.min(10, Number(countInput.value) || 1));
      role.countPerSlot = next;
      countInput.value = String(next);
      await persistConfig();
      runAndRenderSchedule();
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-quiet btn-sm";
    removeBtn.textContent = "Retirer";
    removeBtn.setAttribute("aria-label", `Retirer le pole ${role.name}`);
    removeBtn.addEventListener("click", async () => {
      state.config.roles = state.config.roles.filter((r) => r.id !== role.id);
      renderRoles();
      await persistConfig();
      runAndRenderSchedule();
    });

    li.append(nameSpan, countInput, removeBtn);
    els.rolesList.appendChild(li);
  }
}

function validateSettingsForm() {
  let firstInvalid = null;
  const fields = [
    { input: els.eventName, errId: "event-name-error", msg: "Indiquez un nom de soiree." },
    { input: els.startTime, errId: "start-time-error", msg: "Indiquez une heure de debut." },
    { input: els.endTime, errId: "end-time-error", msg: "Indiquez une heure de fin." },
    { input: els.slotDuration, errId: "slot-duration-error", msg: "Duree entre 10 et 240 minutes." },
    { input: els.bus1Arrival, errId: "bus1-arrival-error", msg: "Indiquez l'heure d'arrivee du Bus 1." },
    { input: els.bus2Arrival, errId: "bus2-arrival-error", msg: "Indiquez l'heure d'arrivee du Bus 2." }
  ];

  for (const item of fields) {
    const errEl = document.getElementById(item.errId);
    if (!item.input.checkValidity()) {
      item.input.setAttribute("aria-invalid", "true");
      if (errEl) errEl.textContent = item.msg;
      if (!firstInvalid) firstInvalid = item.input;
    } else {
      item.input.removeAttribute("aria-invalid");
      if (errEl) errEl.textContent = "";
    }
  }

  if (firstInvalid) {
    firstInvalid.focus();
    return false;
  }
  return true;
}

function renderAlert(type, message) {
  const div = document.createElement("div");
  div.className = `alert ${type === "error" ? "alert-error" : "alert-warn"}`;
  div.textContent = message;
  return div;
}

function runAndRenderSchedule() {
  syncSettingsFromForm();
  els.diagnostics.replaceChildren();

  const bus1Manual = [els.bus1Select1.value, els.bus1Select2.value].filter(Boolean);
  const bus2Manual = [els.bus2Select1.value, els.bus2Select2.value].filter(Boolean);

  try {
    const result = generateSchedule({
      settings: state.config.settings,
      members: state.config.members,
      roles: state.config.roles,
      bus1Manual,
      bus2Manual,
      seed: state.seed
    });
    state.lastResult = result;
    renderScheduleResult(result);
  } catch (err) {
    state.lastResult = null;
    els.diagnostics.appendChild(renderAlert("error", err.message));
    els.busStrip.replaceChildren();
    els.metricsBar.replaceChildren();
    els.scheduleThead.replaceChildren();
    els.scheduleTbody.replaceChildren();
    els.summaryGrid.replaceChildren();
  }
}

function renderScheduleResult(result) {
  const { settings, roles, buses, schedule, memberSummary, stats, warnings, errors } = result;
  els.scheduleSubtitle.textContent = `${settings.eventName} : de ${settings.startTime} a ${settings.endTime} (creneaux de ${settings.slotDuration} min)`;

  for (const err of errors) {
    els.diagnostics.appendChild(renderAlert("error", err));
  }
  for (const warn of warnings) {
    els.diagnostics.appendChild(renderAlert("warn", warn));
  }

  // Render bus cards
  els.busStrip.replaceChildren();
  for (const bus of buses) {
    const card = document.createElement("div");
    card.className = "bus-card";

    const head = document.createElement("div");
    head.className = "bus-card-head";
    const title = document.createElement("strong");
    title.textContent = bus.label;
    const time = document.createElement("span");
    time.className = "bus-time";
    time.textContent = `Arrivee ${bus.arrivalTime}`;
    head.append(title, time);

    const list = document.createElement("div");
    list.className = "bus-staff-list";
    for (const member of bus.members) {
      const chip = document.createElement("span");
      chip.className = "member-chip member-chip-bus";
      chip.textContent = member.name;
      list.appendChild(chip);
    }
    if (bus.members.length < settings.busStaffCount) {
      const missing = document.createElement("span");
      missing.className = "member-chip member-chip-empty";
      missing.textContent = "Effectif manquant";
      list.appendChild(missing);
    }

    const note = document.createElement("p");
    note.className = "hint";
    const unlockInfo = settings.busBufferMinutes > 0 ? ` (+${settings.busBufferMinutes} min de battement)` : "";
    note.textContent = `Bloques en salle avant ${bus.arrivalTime}${unlockInfo}.`;

    card.append(head, list, note);
    els.busStrip.appendChild(card);
  }

  // Metrics bar
  els.metricsBar.replaceChildren();
  const metricItems = [
    ["Creneaux", String(stats.totalSlots)],
    ["Postes pourvus", `${stats.filledSeats}/${stats.totalSeats}`],
    ["Ecart de charge", `${stats.spread} creneau(x)`],
    ["Enchainements", String(stats.backToBackCount)]
  ];
  for (const [label, val] of metricItems) {
    const span = document.createElement("span");
    span.textContent = `${label} : `;
    const strong = document.createElement("span");
    strong.className = "metric-val";
    strong.textContent = val;
    span.appendChild(strong);
    els.metricsBar.appendChild(span);
  }

  // Schedule table header
  els.scheduleThead.replaceChildren();
  const headRow = document.createElement("tr");
  const cornerTh = document.createElement("th");
  cornerTh.scope = "col";
  cornerTh.textContent = "Creneau";
  headRow.appendChild(cornerTh);

  for (const role of roles) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = `${role.name} (${role.countPerSlot})`;
    headRow.appendChild(th);
  }
  els.scheduleThead.appendChild(headRow);

  // Schedule table rows
  els.scheduleTbody.replaceChildren();
  for (const slot of schedule) {
    const tr = document.createElement("tr");
    const rowTh = document.createElement("th");
    rowTh.scope = "row";
    rowTh.textContent = slot.label;
    if (slot.isPartial) {
      const tag = document.createElement("span");
      tag.className = "slot-partial-tag";
      tag.textContent = `${slot.duration} min`;
      rowTh.appendChild(tag);
    }
    tr.appendChild(rowTh);

    for (const role of roles) {
      const td = document.createElement("td");
      td.style.setProperty("--cell-label", JSON.stringify(role.name));
      const wrap = document.createElement("div");
      wrap.className = "cell-occupants";

      const occupants = slot.assignments[role.id] ?? [];
      for (const person of occupants) {
        const chip = document.createElement("span");
        if (person) {
          chip.className = "member-chip";
          chip.textContent = person.name;
        } else {
          chip.className = "member-chip member-chip-empty";
          chip.textContent = "Non pourvu";
        }
        wrap.appendChild(chip);
      }
      td.appendChild(wrap);
      tr.appendChild(td);
    }
    els.scheduleTbody.appendChild(tr);
  }

  // Member summary
  els.summaryGrid.replaceChildren();
  const sortedSummary = [...memberSummary].sort((a, b) => b.totalDuties - a.totalDuties || a.name.localeCompare(b.name));
  for (const item of sortedSummary) {
    const card = document.createElement("article");
    card.className = "summary-card";

    const head = document.createElement("div");
    head.className = "summary-card-head";
    const nameEl = document.createElement("span");
    nameEl.className = "summary-name";
    nameEl.textContent = item.name;
    const countEl = document.createElement("span");
    countEl.className = "summary-count";
    countEl.textContent = `${item.totalDuties} mission(s)`;
    head.append(nameEl, countEl);

    const list = document.createElement("ul");
    list.className = "summary-shifts";
    if (item.busNumber) {
      const li = document.createElement("li");
      li.textContent = `Bus ${item.busNumber} (arrivee ${item.busArrivalTime})`;
      li.style.fontWeight = "600";
      li.style.color = "var(--primary)";
      list.appendChild(li);
    }
    for (const sh of item.shifts) {
      const li = document.createElement("li");
      li.textContent = `${sh.slotLabel} : ${sh.roleName}`;
      list.appendChild(li);
    }
    if (!item.busNumber && item.shifts.length === 0) {
      const li = document.createElement("li");
      li.textContent = "Aucun staff attribue";
      list.appendChild(li);
    }

    card.append(head, list);
    els.summaryGrid.appendChild(card);
  }
}

function exportScheduleCsv() {
  if (!state.lastResult) return;
  const { roles, buses, schedule } = state.lastResult;
  const escapeCsv = (val) => `"${String(val).replace(/"/g, '""')}"`;

  const lines = [];
  lines.push(["Type", "Horaire", ...roles.map((r) => r.name)].map(escapeCsv).join(";"));
  for (const bus of buses) {
    const names = bus.members.map((m) => m.name).join(", ");
    lines.push([bus.label, bus.arrivalTime, names].map(escapeCsv).join(";"));
  }
  for (const slot of schedule) {
    const cols = roles.map((r) =>
      (slot.assignments[r.id] ?? []).map((m) => (m ? m.name : "Non pourvu")).join(", ")
    );
    lines.push(["Creneau", slot.label, ...cols].map(escapeCsv).join(";"));
  }

  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "planning-staff-bde.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function downloadConfigJson() {
  const blob = new Blob([JSON.stringify(state.config, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "config.json";
  a.click();
  URL.revokeObjectURL(url);
}

function getSupabaseSettings() {
  const saved = safeReadLocal(SB_SETTINGS_KEY) ?? {};
  const fromRepo = state.config?.supabase ?? {};
  return {
    url: (saved.url || fromRepo.url || "").replace(/\/+$/, ""),
    anonKey: saved.anonKey || fromRepo.anonKey || ""
  };
}

function getSessionPassword() {
  try {
    return sessionStorage.getItem(SB_PASSWORD_KEY) || "";
  } catch {
    return "";
  }
}

function setSessionPassword(value) {
  try {
    sessionStorage.setItem(SB_PASSWORD_KEY, value);
  } catch {
    // Private mode: password will be asked again.
  }
}

function sbHeaders(anonKey) {
  const headers = { apikey: anonKey, "Content-Type": "application/json" };
  // Legacy anon keys are JWTs; new sb_publishable_ keys must not go in Authorization.
  if (anonKey.startsWith("eyJ")) headers.Authorization = `Bearer ${anonKey}`;
  return headers;
}

async function fetchOnlineState({ url, anonKey }) {
  const res = await fetch(`${url}/rest/v1/bde_state?id=eq.main&select=config,schedule,updated_at`, {
    headers: sbHeaders(anonKey)
  });
  if (!res.ok) throw new Error(`Lecture Supabase impossible (HTTP ${res.status}).`);
  const rows = await res.json();
  return rows[0] ?? null;
}

async function publishOnline({ url, anonKey }, password) {
  const res = await fetch(`${url}/rest/v1/rpc/save_bde_state`, {
    method: "POST",
    headers: sbHeaders(anonKey),
    body: JSON.stringify({ p_password: password, p_config: state.config, p_schedule: state.lastResult })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Publication refusee (HTTP ${res.status}).`);
  }
}

function openSyncDialog(message = "") {
  const sb = getSupabaseSettings();
  els.sbUrl.value = sb.url;
  els.sbKey.value = sb.anonKey;
  els.sbPassword.value = getSessionPassword();
  els.sbFeedback.textContent = message;
  els.syncDialog.showModal();
  const firstEmpty = [els.sbUrl, els.sbKey, els.sbPassword].find((el) => !el.value);
  (firstEmpty ?? els.sbPassword).focus();
}

async function handlePublish() {
  const sb = getSupabaseSettings();
  const password = getSessionPassword();
  if (!sb.url || !sb.anonKey || !password) {
    openSyncDialog("Renseignez la connexion Supabase et le mot de passe BDE.");
    return;
  }
  setStatus("Publication en cours...");
  try {
    await publishOnline(sb, password);
    setStatus("Planning publie en ligne");
    if (els.syncDialog.open) els.sbFeedback.textContent = "Publie. Tout le BDE voit maintenant ce planning.";
  } catch (err) {
    setStatus("Echec de publication");
    openSyncDialog(err.message);
  }
}

function applyLoadedConfig() {
  populateSettingsForm();
  populateBusSelectors();
  renderMembers();
  renderRoles();
}

function wireEvents() {
  els.settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateSettingsForm()) return;
    syncSettingsFromForm();
    await persistConfig();
    state.seed = Date.now();
    runAndRenderSchedule();
  });

  // Validate on blur after edit, clear on input
  for (const input of els.settingsForm.querySelectorAll("input")) {
    input.addEventListener("input", () => {
      input.removeAttribute("aria-invalid");
      const errEl = document.getElementById(`${input.id}-error`);
      if (errEl) errEl.textContent = "";
    });
    input.addEventListener("blur", () => {
      if (input.value && !input.checkValidity()) {
        input.setAttribute("aria-invalid", "true");
      }
    });
  }

  els.generateHeaderBtn.addEventListener("click", () => {
    els.settingsForm.requestSubmit();
  });

  els.rerollBtn.addEventListener("click", () => {
    state.seed = Date.now() + Math.floor(Math.random() * 10000);
    runAndRenderSchedule();
  });

  els.exportCsvBtn.addEventListener("click", exportScheduleCsv);

  els.addMemberForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = els.newMemberName.value.trim();
    if (!name) {
      els.newMemberName.setAttribute("aria-invalid", "true");
      els.newMemberName.focus();
      return;
    }
    els.newMemberName.removeAttribute("aria-invalid");
    state.config.members.push({
      id: `m-${Date.now().toString(36)}`,
      name,
      active: true
    });
    els.newMemberName.value = "";
    populateBusSelectors();
    renderMembers();
    await persistConfig();
    runAndRenderSchedule();
  });

  els.addRoleForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = els.newRoleName.value.trim();
    const countPerSlot = Math.max(1, Math.min(10, Number(els.newRoleCount.value) || 1));
    if (!name) {
      els.newRoleName.setAttribute("aria-invalid", "true");
      els.newRoleName.focus();
      return;
    }
    els.newRoleName.removeAttribute("aria-invalid");
    state.config.roles.push({
      id: `r-${Date.now().toString(36)}`,
      name,
      countPerSlot
    });
    els.newRoleName.value = "";
    els.newRoleCount.value = "1";
    renderRoles();
    await persistConfig();
    runAndRenderSchedule();
  });

  els.publishBtn.addEventListener("click", handlePublish);
  els.openSyncBtn.addEventListener("click", () => openSyncDialog());
  els.closeSyncBtn.addEventListener("click", () => els.syncDialog.close());
  els.downloadJsonBtn.addEventListener("click", downloadConfigJson);

  els.importJsonInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed.settings || !Array.isArray(parsed.members) || !Array.isArray(parsed.roles)) {
        throw new Error("Format JSON invalide.");
      }
      state.config = parsed;
      applyLoadedConfig();
      await persistConfig();
      runAndRenderSchedule();
      els.sbFeedback.textContent = "Configuration importee. Pensez a publier en ligne.";
    } catch (err) {
      els.sbFeedback.textContent = err.message;
    } finally {
      els.importJsonInput.value = "";
    }
  });

  els.sbReloadBtn.addEventListener("click", async () => {
    const sb = { url: els.sbUrl.value.trim().replace(/\/+$/, ""), anonKey: els.sbKey.value.trim() };
    try {
      const online = await fetchOnlineState(sb);
      if (!online) throw new Error("Aucune donnee publiee pour l'instant.");
      safeWriteLocal(SB_SETTINGS_KEY, sb);
      loadOnline(online);
      els.sbFeedback.textContent = "Donnees en ligne rechargees.";
    } catch (err) {
      els.sbFeedback.textContent = err.message;
    }
  });

  els.sbForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = els.sbUrl.value.trim().replace(/\/+$/, "");
    const anonKey = els.sbKey.value.trim();
    const password = els.sbPassword.value;
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !anonKey || !password) {
      els.sbFeedback.textContent = "URL au format https://xxxx.supabase.co, cle anon et mot de passe requis.";
      return;
    }
    safeWriteLocal(SB_SETTINGS_KEY, { url, anonKey });
    setSessionPassword(password);
    els.sbFeedback.textContent = "Publication en cours...";
    await handlePublish();
  });
}

function loadOnline(online) {
  state.config = { ...online.config, supabase: state.config?.supabase ?? online.config.supabase };
  safeWriteLocal(CONFIG_STORAGE_KEY, state.config);
  applyLoadedConfig();
  if (online.schedule?.schedule) {
    state.lastResult = online.schedule;
    els.diagnostics.replaceChildren();
    renderScheduleResult(online.schedule);
    const when = new Date(online.updated_at).toLocaleString("fr-FR");
    els.scheduleSubtitle.textContent += ` . Planning officiel publie le ${when}`;
  } else {
    runAndRenderSchedule();
  }
  setStatus("Synchronise en ligne");
}

async function init() {
  wireEvents();
  const local = safeReadLocal(CONFIG_STORAGE_KEY);
  const isLocalhost = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  try {
    const repoConfig = await fetchRepoConfig();
    state.config = isLocalhost ? repoConfig : local ?? repoConfig;
    if (!state.config.supabase) state.config.supabase = repoConfig.supabase;
    setStatus(isLocalhost ? "Connecte a data/config.json" : "Charge depuis le site");
  } catch {
    if (!local) {
      setStatus("Erreur de chargement config.json");
      return;
    }
    state.config = local;
    setStatus("Charge depuis navigateur");
  }

  const sb = getSupabaseSettings();
  if (sb.url && sb.anonKey) {
    setStatus("Chargement en ligne...");
    try {
      const online = await fetchOnlineState(sb);
      if (online) {
        loadOnline(online);
        return;
      }
      setStatus("Rien de publie en ligne");
    } catch {
      setStatus("Hors ligne, donnees locales");
    }
  }

  applyLoadedConfig();
  runAndRenderSchedule();
}

init();
