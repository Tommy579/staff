import { generateSchedule } from "./scheduler.js";
import {
  normalizeSupabaseUrl,
  isSupabaseProjectUrl,
  supabaseErrorMessage
} from "./supabase-url.js";

const CONFIG_STORAGE_KEY = "bde_staff_auto_config_v1";
const SB_SETTINGS_KEY = "bde_staff_auto_sb_v1";
const SB_PASSWORD_COOKIE = "bde_staff_auto_pwd";
const SB_COOKIE_DAYS = 30;

const state = {
  config: null,
  lastResult: null,
  seed: Date.now(),
  serverWritable: false,
  highlightedMemberId: ""
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
  memberFilter: document.getElementById("member-filter"),
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
  sbForm: document.getElementById("sb-form"),
  sbUrl: document.getElementById("sb-url"),
  sbKey: document.getElementById("sb-key"),
  sbPassword: document.getElementById("sb-password"),
  sbFeedback: document.getElementById("sb-feedback"),
  sbReloadBtn: document.getElementById("sb-reload-btn"),
  sbLogoutBtn: document.getElementById("sb-logout-btn")
};

let autoPublishTimer = null;
let publishQueue = Promise.resolve();

function setStatus(text) {
  els.status.textContent = text;
  let tone = "ok";
  if (/chec|erreur|hors ligne|requis/i.test(text)) tone = "bad";
  else if (/\.\.\.$/.test(text)) tone = "busy";
  else if (/local|navigateur|lecture|non publi/i.test(text)) tone = "idle";
  els.status.dataset.tone = tone;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function createCloseIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M4 4l8 8M12 4l-8 8");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  svg.appendChild(path);
  return svg;
}

function createRemoveButton(label, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn roster-remove";
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.appendChild(createCloseIcon());
  btn.addEventListener("click", onClick);
  return btn;
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
        setStatus("Sauvegardé (config.json)");
        return;
      }
    } catch {
      // Fallback to localStorage only.
    }
  }
  setStatus("Sauvegarde locale");
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
    autoOpt.textContent = "Tirage auto";
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

  // Also update member highlight filter in toolbar
  if (els.memberFilter) {
    const prevFilter = els.memberFilter.value;
    els.memberFilter.replaceChildren();
    const allOpt = document.createElement("option");
    allOpt.value = "";
    allOpt.textContent = "Tous les staffeurs";
    els.memberFilter.appendChild(allOpt);

    for (const member of active) {
      const opt = document.createElement("option");
      opt.value = member.id;
      opt.textContent = member.name;
      els.memberFilter.appendChild(opt);
    }
    if (prevFilter && active.some((m) => m.id === prevFilter)) {
      els.memberFilter.value = prevFilter;
    } else {
      setHighlightedMember("");
    }
  }
}

function setHighlightedMember(memberId) {
  const next = state.highlightedMemberId === memberId ? "" : memberId;
  state.highlightedMemberId = next;
  if (els.memberFilter && els.memberFilter.value !== next) {
    els.memberFilter.value = next;
  }
  if (next) {
    document.body.setAttribute("data-highlight-member", next);
  } else {
    document.body.removeAttribute("data-highlight-member");
  }
  for (const el of document.querySelectorAll("[data-member-id]")) {
    el.classList.toggle("is-highlighted", Boolean(next && el.dataset.memberId === next));
  }
}

function renderMembers() {
  const members = state.config.members;
  const activeCount = members.filter((m) => m.active !== false).length;
  els.membersCount.textContent = `${activeCount}/${members.length}`;
  els.membersList.replaceChildren();

  const transportOptions = [
    { value: "car", label: "Voiture" },
    { value: "bus1", label: "Bus 1" },
    { value: "bus2", label: "Bus 2" }
  ];

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
      await saveAndAutoPublish();
    });

    const span = document.createElement("span");
    span.textContent = member.name;

    label.append(checkbox, span);

    const transportSelect = document.createElement("select");
    transportSelect.className = "transport-select";
    transportSelect.setAttribute("aria-label", `Moyen d'arrivée pour ${member.name}`);
    for (const optDef of transportOptions) {
      const opt = document.createElement("option");
      opt.value = optDef.value;
      opt.textContent = optDef.label;
      transportSelect.appendChild(opt);
    }
    transportSelect.value =
      member.transport === "bus1" || member.transport === "bus2" ? member.transport : "car";
    transportSelect.addEventListener("change", async () => {
      member.transport = transportSelect.value;
      await saveAndAutoPublish();
    });

    const removeBtn = createRemoveButton(`Retirer ${member.name}`, async () => {
      state.config.members = state.config.members.filter((m) => m.id !== member.id);
      populateBusSelectors();
      renderMembers();
      await saveAndAutoPublish();
    });

    li.append(label, transportSelect, removeBtn);
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
    nameSpan.className = "roster-name";
    nameSpan.textContent = role.name;

    const countInput = document.createElement("input");
    countInput.type = "number";
    countInput.min = "1";
    countInput.max = "10";
    countInput.value = String(role.countPerSlot);
    countInput.className = "role-count-input";
    countInput.setAttribute("aria-label", `Places par créneau pour ${role.name}`);
    countInput.setAttribute("aria-invalid", "false");
    countInput.addEventListener("change", async () => {
      const next = Math.max(1, Math.min(10, Number(countInput.value) || 1));
      role.countPerSlot = next;
      countInput.value = String(next);
      await saveAndAutoPublish();
    });

    const removeBtn = createRemoveButton(`Retirer le pôle ${role.name}`, async () => {
      state.config.roles = state.config.roles.filter((r) => r.id !== role.id);
      renderRoles();
      await saveAndAutoPublish();
    });

    li.append(nameSpan, countInput, removeBtn);
    els.rolesList.appendChild(li);
  }
}

// Accessible error synchronization (modern-web-guidance: accessible-error-announcement)
const linkError = (el, shown) => {
  const errorId = el.dataset?.error;
  if (!errorId) return;
  const ids = (el.getAttribute("aria-describedby") || "")
    .split(/\s+/)
    .filter((id) => id && id !== errorId);
  if (shown) ids.push(errorId);
  if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
  else el.removeAttribute("aria-describedby");
};

const announcer = document.createElement("div");
announcer.setAttribute("aria-live", "polite");
announcer.classList.add("visually-hidden");
document.body.append(announcer);
let announceTimer;

function syncFieldValidity(el, forceInvalid = false, shouldAnnounce = false) {
  if (!el.matches?.("input, select, textarea")) return;
  const isInvalid = forceInvalid || !el.validity.valid;
  if (isInvalid) {
    el.setAttribute("aria-invalid", "true");
    el.classList.add("user-invalid-fallback");
    linkError(el, true);
    if (shouldAnnounce && el.dataset?.error) {
      const errNode = document.getElementById(el.dataset.error);
      if (errNode) {
        clearTimeout(announceTimer);
        announcer.textContent = "";
        announceTimer = setTimeout(() => {
          announcer.textContent = errNode.textContent.trim();
        }, 350);
      }
    }
  } else {
    el.setAttribute("aria-invalid", "false");
    el.classList.remove("user-invalid-fallback");
    linkError(el, false);
  }
}

function validateSettingsForm() {
  let firstInvalid = null;
  const fields = [
    els.eventName,
    els.startTime,
    els.endTime,
    els.slotDuration,
    els.bus1Arrival,
    els.bus2Arrival
  ];

  for (const input of fields) {
    if (!input.checkValidity()) {
      syncFieldValidity(input, true, false);
      if (!firstInvalid) firstInvalid = input;
    } else {
      syncFieldValidity(input, false, false);
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

function createMemberChip(member, extraClass = "") {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = `member-chip ${extraClass}`.trim();
  chip.textContent = member.name;
  chip.dataset.memberId = member.id;
  if (state.highlightedMemberId && state.highlightedMemberId === member.id) {
    chip.classList.add("is-highlighted");
  }
  chip.addEventListener("click", () => setHighlightedMember(member.id));
  return chip;
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
  els.scheduleSubtitle.textContent = `${settings.eventName} · ${settings.startTime} – ${settings.endTime} · créneaux de ${settings.slotDuration} min`;
  const totalSlots = schedule.length;

  for (const err of errors) {
    els.diagnostics.appendChild(renderAlert("error", err));
  }
  for (const warn of warnings) {
    els.diagnostics.appendChild(renderAlert("warn", warn));
  }

  // Render compact bus cards
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
    const unlockInfo = settings.busBufferMinutes > 0 ? ` +${settings.busBufferMinutes} min` : "";
    time.textContent = `${bus.arrivalTime}${unlockInfo}`;
    time.title = `Arrivée à ${bus.arrivalTime}`;
    head.append(title, time);

    const list = document.createElement("div");
    list.className = "bus-staff-list";
    for (const member of bus.members) {
      list.appendChild(createMemberChip(member, "member-chip-bus"));
    }
    if (bus.members.length < settings.busStaffCount) {
      const missing = document.createElement("span");
      missing.className = "member-chip member-chip-empty";
      missing.textContent = "Effectif manquant";
      list.appendChild(missing);
    }

    card.append(head, list);
    els.busStrip.appendChild(card);
  }

  // Metrics bar
  els.metricsBar.replaceChildren();
  const metricItems = [
    ["Postes pourvus", `${stats.filledSeats}/${stats.totalSeats}`, stats.filledSeats < stats.totalSeats ? "bad" : ""],
    ["Créneaux", String(stats.totalSlots ?? totalSlots), ""],
    ["Écart max", `${stats.spread}`, ""],
    ["Enchaînements", String(stats.backToBackCount), stats.backToBackCount > 0 ? "warn" : ""]
  ];
  for (const [label, val, tone] of metricItems) {
    const item = document.createElement("div");
    item.className = "metric-item";
    if (tone) item.dataset.tone = tone;
    const labelSpan = document.createElement("span");
    labelSpan.className = "metric-label";
    labelSpan.textContent = label;
    const strong = document.createElement("span");
    strong.className = "metric-val";
    strong.textContent = val;
    item.append(labelSpan, strong);
    els.metricsBar.appendChild(item);
  }

  // Schedule table header
  els.scheduleThead.replaceChildren();
  const headRow = document.createElement("tr");
  const cornerTh = document.createElement("th");
  cornerTh.scope = "col";
  cornerTh.textContent = "Horaire";
  headRow.appendChild(cornerTh);

  for (const role of roles) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = role.name;
    const badge = document.createElement("span");
    badge.className = "role-cap-badge";
    badge.textContent = `×${role.countPerSlot}`;
    th.appendChild(badge);
    headRow.appendChild(th);
  }
  els.scheduleThead.appendChild(headRow);

  // Schedule table rows
  els.scheduleTbody.replaceChildren();
  for (const slot of schedule) {
    const tr = document.createElement("tr");
    const rowTh = document.createElement("th");
    rowTh.scope = "row";
    const [slotStart, slotEnd] = slot.label.split(" - ");
    const startEl = document.createElement("span");
    startEl.className = "slot-start";
    startEl.textContent = slotStart;
    const endEl = document.createElement("span");
    endEl.className = "slot-end";
    endEl.textContent = slotEnd ? `– ${slotEnd}` : "";
    rowTh.setAttribute("aria-label", slot.label);
    rowTh.append(startEl, endEl);
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
        if (person) {
          wrap.appendChild(createMemberChip(person));
        } else {
          const emptyChip = document.createElement("span");
          emptyChip.className = "member-chip member-chip-empty";
          emptyChip.textContent = "Non pourvu";
          wrap.appendChild(emptyChip);
        }
      }
      td.appendChild(wrap);
      tr.appendChild(td);
    }
    els.scheduleTbody.appendChild(tr);
  }

  // Member summary
  els.summaryGrid.replaceChildren();
  const sortedSummary = [...memberSummary].sort(
    (a, b) => b.totalDuties - a.totalDuties || a.name.localeCompare(b.name)
  );
  for (const item of sortedSummary) {
    const card = document.createElement("article");
    card.className = "summary-card";
    card.dataset.memberId = item.id;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Filtrer les créneaux de ${item.name}`);
    if (state.highlightedMemberId && state.highlightedMemberId === item.id) {
      card.classList.add("is-highlighted");
    }
    card.addEventListener("click", () => setHighlightedMember(item.id));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setHighlightedMember(item.id);
      }
    });

    const head = document.createElement("div");
    head.className = "summary-card-head";
    const nameEl = document.createElement("span");
    nameEl.className = "summary-name";
    nameEl.textContent = item.name;
    const countEl = document.createElement("span");
    countEl.className = "summary-count";
    countEl.textContent = `${item.totalDuties}`;
    countEl.title = `${item.totalDuties} affectation(s)`;
    head.append(nameEl, countEl);

    const list = document.createElement("ul");
    list.className = "summary-shifts";
    if (item.busNumber) {
      const li = document.createElement("li");
      li.className = "summary-bus";
      li.textContent = `Staff Bus ${item.busNumber} · ${item.busArrivalTime}`;
      list.appendChild(li);
    } else if (item.transport === "bus1") {
      const li = document.createElement("li");
      li.className = "summary-bus";
      li.textContent = `Arrivée Bus 1 · ${settings.bus1Arrival}`;
      list.appendChild(li);
    } else if (item.transport === "bus2") {
      const li = document.createElement("li");
      li.className = "summary-bus";
      li.textContent = `Arrivée Bus 2 · ${settings.bus2Arrival}`;
      list.appendChild(li);
    } else {
      const li = document.createElement("li");
      li.textContent = `Voiture · dès ${settings.startTime}`;
      list.appendChild(li);
    }
    for (const sh of item.shifts) {
      const li = document.createElement("li");
      li.textContent = `${sh.slotLabel} · ${sh.roleName}`;
      list.appendChild(li);
    }
    if (!item.busNumber && item.shifts.length === 0) {
      const li = document.createElement("li");
      li.className = "summary-none";
      li.textContent = "Aucun créneau";
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
    url: normalizeSupabaseUrl(saved.url || fromRepo.url || ""),
    anonKey: saved.anonKey || fromRepo.anonKey || ""
  };
}

function getSavedPassword() {
  try {
    const match = document.cookie
      .split("; ")
      .find((row) => row.startsWith(`${SB_PASSWORD_COOKIE}=`));
    if (match) return decodeURIComponent(match.slice(SB_PASSWORD_COOKIE.length + 1));
  } catch {
    // Ignore cookie read errors.
  }
  return "";
}

function setSavedPassword(value) {
  try {
    const secure = location.protocol === "https:" ? "; Secure" : "";
    if (!value) {
      document.cookie = `${SB_PASSWORD_COOKIE}=; path=/; max-age=0; SameSite=Lax${secure}`;
      return;
    }
    const maxAge = 60 * 60 * 24 * SB_COOKIE_DAYS;
    document.cookie = `${SB_PASSWORD_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
  } catch {
    // Ignore cookie write errors.
  }
}

function updateAuthUi() {
  const loggedIn = Boolean(getSavedPassword());
  if (els.openSyncBtn) {
    els.openSyncBtn.textContent = loggedIn ? "Connecté BDE" : "Connexion BDE";
  }
  if (els.sbLogoutBtn) {
    els.sbLogoutBtn.hidden = !loggedIn;
  }
}

function sbHeaders(anonKey) {
  const headers = { apikey: anonKey, "Content-Type": "application/json" };
  if (anonKey.startsWith("eyJ")) headers.Authorization = `Bearer ${anonKey}`;
  return headers;
}

async function fetchOnlineState({ url, anonKey }) {
  const res = await fetch(`${url}/rest/v1/bde_state?id=eq.main&select=config,schedule,updated_at`, {
    headers: sbHeaders(anonKey)
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(supabaseErrorMessage("Lecture Supabase impossible", res.status, body));
  }
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
    throw new Error(supabaseErrorMessage("Publication refusée", res.status, body));
  }
}

function openSyncDialog(message = "") {
  const sb = getSupabaseSettings();
  els.sbUrl.value = sb.url;
  els.sbKey.value = sb.anonKey;
  els.sbPassword.value = getSavedPassword();
  els.sbFeedback.textContent = message;
  updateAuthUi();
  els.syncDialog.showModal();
  const firstEmpty = [els.sbUrl, els.sbKey, els.sbPassword].find((el) => !el.value);
  (firstEmpty ?? els.sbPassword).focus();
}

function scheduleAutoPublish() {
  const sb = getSupabaseSettings();
  const password = getSavedPassword();
  if (!sb.url || !sb.anonKey) return;
  if (!password) {
    setStatus("Modifié en local (connexion requise)");
    return;
  }

  clearTimeout(autoPublishTimer);
  setStatus("Enregistrement...");
  autoPublishTimer = setTimeout(() => {
    publishQueue = publishQueue
      .then(async () => {
        const currentSb = getSupabaseSettings();
        const currentPwd = getSavedPassword();
        if (!currentSb.url || !currentSb.anonKey || !currentPwd) return;
        await publishOnline(currentSb, currentPwd);
        setStatus("Synchronisé en ligne");
      })
      .catch((err) => {
        if (/mot de passe/i.test(err.message)) {
          setSavedPassword("");
          updateAuthUi();
          setStatus("Mot de passe requis");
          openSyncDialog(err.message);
        } else {
          setStatus("Échec synchronisation");
        }
      });
  }, 400);
}

async function saveAndAutoPublish() {
  runAndRenderSchedule();
  await persistConfig();
  scheduleAutoPublish();
}

function applyLoadedConfig() {
  populateSettingsForm();
  populateBusSelectors();
  renderMembers();
  renderRoles();
}

function wireSidebarTabs() {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const activateTab = (tab, moveFocus = false) => {
    for (const t of tabs) {
      const selected = t === tab;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
      const panelId = t.getAttribute("aria-controls");
      const panel = document.getElementById(panelId);
      if (panel) panel.hidden = !selected;
    }
    if (moveFocus) tab.focus();
  };

  for (const tab of tabs) {
    tab.addEventListener("click", () => activateTab(tab, false));
    tab.addEventListener("keydown", (e) => {
      const idx = tabs.indexOf(tab);
      if (e.key === "ArrowRight") {
        e.preventDefault();
        activateTab(tabs[(idx + 1) % tabs.length], true);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        activateTab(tabs[(idx - 1 + tabs.length) % tabs.length], true);
      }
    });
  }
}

function wireDialogLightDismiss() {
  // Fallback for browsers without native <dialog closedby="any"> support (modern-web-guidance: light-dismiss-a-dialog)
  if (!("closedBy" in HTMLDialogElement.prototype)) {
    els.syncDialog.addEventListener("click", (event) => {
      if (event.target !== els.syncDialog) return;
      const rect = els.syncDialog.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (isDialogContent) return;
      els.syncDialog.close();
    });
  }
}

function wireEvents() {
  wireSidebarTabs();
  wireDialogLightDismiss();

  els.settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateSettingsForm()) return;
    syncSettingsFromForm();
    state.seed = Date.now();
    await saveAndAutoPublish();
  });

  for (const input of els.settingsForm.querySelectorAll("input, select")) {
    input.addEventListener("input", () => {
      syncFieldValidity(input, false, false);
    });
    input.addEventListener("blur", () => {
      if (input.value && !input.checkValidity()) {
        syncFieldValidity(input, true, true);
      }
    });
    if (input.tagName === "SELECT") {
      input.addEventListener("change", () => saveAndAutoPublish());
    }
  }

  els.rerollBtn.addEventListener("click", async () => {
    state.seed = Date.now() + Math.floor(Math.random() * 10000);
    await saveAndAutoPublish();
  });

  if (els.memberFilter) {
    els.memberFilter.addEventListener("change", () => {
      const val = els.memberFilter.value;
      state.highlightedMemberId = "";
      setHighlightedMember(val);
    });
  }

  els.exportCsvBtn.addEventListener("click", exportScheduleCsv);

  els.addMemberForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = els.newMemberName.value.trim();
    if (!name) {
      els.newMemberName.setAttribute("aria-invalid", "true");
      els.newMemberName.focus();
      return;
    }
    els.newMemberName.setAttribute("aria-invalid", "false");
    state.config.members.push({
      id: `m-${Date.now().toString(36)}`,
      name,
      active: true,
      transport: "car"
    });
    els.newMemberName.value = "";
    populateBusSelectors();
    renderMembers();
    await saveAndAutoPublish();
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
    els.newRoleName.setAttribute("aria-invalid", "false");
    state.config.roles.push({
      id: `r-${Date.now().toString(36)}`,
      name,
      countPerSlot
    });
    els.newRoleName.value = "";
    els.newRoleCount.value = "1";
    renderRoles();
    await saveAndAutoPublish();
  });

  els.openSyncBtn.addEventListener("click", () => openSyncDialog());
  els.closeSyncBtn.addEventListener("click", () => els.syncDialog.close());
  els.downloadJsonBtn.addEventListener("click", downloadConfigJson);

  els.sbLogoutBtn.addEventListener("click", () => {
    setSavedPassword("");
    els.sbPassword.value = "";
    updateAuthUi();
    setStatus("Mode lecture");
    els.sbFeedback.textContent = "Déconnecté. Le planning reste visible en lecture seule.";
  });

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
      await saveAndAutoPublish();
      els.sbFeedback.textContent = "Configuration importée.";
    } catch (err) {
      els.sbFeedback.textContent = err.message;
    } finally {
      els.importJsonInput.value = "";
    }
  });

  els.sbReloadBtn.addEventListener("click", async () => {
    const sb = { url: normalizeSupabaseUrl(els.sbUrl.value), anonKey: els.sbKey.value.trim() };
    try {
      const online = await fetchOnlineState(sb);
      if (!online) throw new Error("Aucune donnée publiée pour l'instant.");
      safeWriteLocal(SB_SETTINGS_KEY, sb);
      loadOnline(online);
      els.sbFeedback.textContent = "Données en ligne rechargées.";
    } catch (err) {
      els.sbFeedback.textContent = err.message;
    }
  });

  els.sbForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = normalizeSupabaseUrl(els.sbUrl.value);
    const anonKey = els.sbKey.value.trim();
    const password = els.sbPassword.value;
    if (!isSupabaseProjectUrl(url) || !anonKey || !password) {
      els.sbFeedback.textContent = "URL https://xxxx.supabase.co, clé anon et mot de passe requis.";
      return;
    }
    els.sbUrl.value = url;
    safeWriteLocal(SB_SETTINGS_KEY, { url, anonKey });
    els.sbFeedback.textContent = "Connexion et synchronisation...";
    setStatus("Synchronisation...");
    try {
      await publishOnline({ url, anonKey }, password);
      setSavedPassword(password);
      updateAuthUi();
      setStatus("Synchronisé en ligne");
      els.sbFeedback.textContent = "Connecté. Chaque modification est maintenant enregistrée automatiquement.";
      els.syncDialog.close();
    } catch (err) {
      setSavedPassword("");
      updateAuthUi();
      setStatus("Mot de passe requis");
      els.sbFeedback.textContent = err.message;
    }
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
    els.scheduleSubtitle.textContent += ` · Publié le ${when}`;
  } else {
    runAndRenderSchedule();
  }
  setStatus("Synchronisé en ligne");
}

async function init() {
  updateAuthUi();
  wireEvents();
  const local = safeReadLocal(CONFIG_STORAGE_KEY);
  const isLocalhost = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  try {
    const repoConfig = await fetchRepoConfig();
    state.config = isLocalhost ? repoConfig : local ?? repoConfig;
    if (!state.config.supabase) state.config.supabase = repoConfig.supabase;
    setStatus(isLocalhost ? "Local (config.json)" : "Prêt");
  } catch {
    if (!local) {
      setStatus("Erreur config.json");
      return;
    }
    state.config = local;
    setStatus("Mode navigateur");
  }

  const sb = getSupabaseSettings();
  if (sb.url && sb.anonKey) {
    setStatus("Synchronisation...");
    try {
      const online = await fetchOnlineState(sb);
      if (online) {
        loadOnline(online);
        return;
      }
      setStatus("Local (rien en ligne)");
    } catch {
      setStatus("Hors ligne");
    }
  }

  applyLoadedConfig();
  runAndRenderSchedule();
}

init();
