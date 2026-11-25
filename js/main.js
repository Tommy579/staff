import { generateSchedule, sortCustomChangeTimes } from "./scheduler.js";
import { buildXlsxWorkbook } from "./xlsx.js";
import {
  normalizeSupabaseUrl,
  isSupabaseProjectUrl,
  supabaseErrorMessage
} from "./supabase-url.js";

const CONFIG_STORAGE_KEY = "bde_staff_auto_config_v1";
const SB_SETTINGS_KEY = "bde_staff_auto_sb_v1";
const SB_PASSWORD_COOKIE = "bde_staff_auto_pwd";
const SB_COOKIE_DAYS = 30;
const DEFAULT_EVENT_TYPE = "soiree";
const EVENT_TYPE_ORDER = ["soiree", "ob", "wec", "ski"];

const EVENT_TYPE_PRESETS = {
  soiree: {
    label: "Soirée",
    eventName: "Soiree Integration Polytech",
    startTime: "22:00",
    endTime: "04:00",
    slotMode: "fixed",
    slotDuration: 45,
    bus1Arrival: "22:30",
    bus2Arrival: "23:15",
    busStaffCount: 2,
    busBufferMinutes: 0
  },
  ob: {
    label: "OB",
    eventName: "Open Bar BDE",
    startTime: "20:00",
    endTime: "01:00",
    slotMode: "fixed",
    slotDuration: 30,
    bus1Arrival: "20:15",
    bus2Arrival: "21:00",
    busStaffCount: 2,
    busBufferMinutes: 0
  },
  wec: {
    label: "WEC",
    eventName: "WEC Polytech",
    startTime: "21:00",
    endTime: "03:00",
    slotMode: "fixed",
    slotDuration: 45,
    bus1Arrival: "21:00",
    bus2Arrival: "21:30",
    busStaffCount: 2,
    busBufferMinutes: 0
  },
  ski: {
    label: "Ski",
    eventName: "Semaine Ski Polytech",
    startTime: "21:30",
    endTime: "02:30",
    slotMode: "fixed",
    slotDuration: 45,
    bus1Arrival: "21:30",
    bus2Arrival: "22:00",
    busStaffCount: 2,
    busBufferMinutes: 0
  }
};

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
  presetButtons: Array.from(document.querySelectorAll(".preset-btn[data-preset]")),
  eventName: document.getElementById("event-name"),
  startTime: document.getElementById("start-time"),
  endTime: document.getElementById("end-time"),
  slotMode: document.getElementById("slot-mode"),
  slotDurationWrap: document.getElementById("slot-duration-wrap"),
  slotDuration: document.getElementById("slot-duration"),
  customChangesWrap: document.getElementById("custom-changes-wrap"),
  newChangeTime: document.getElementById("new-change-time"),
  addChangeBtn: document.getElementById("add-change-btn"),
  customChangesList: document.getElementById("custom-changes-list"),
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
  exportXlsxBtn: document.getElementById("export-xlsx-btn"),
  memberFilter: document.getElementById("member-filter"),
  addMemberForm: document.getElementById("add-member-form"),
  newMemberName: document.getElementById("new-member-name"),
  membersList: document.getElementById("members-list"),
  membersCount: document.getElementById("members-count"),
  addRoleForm: document.getElementById("add-role-form"),
  newRoleName: document.getElementById("new-role-name"),
  newRoleCount: document.getElementById("new-role-count"),
  addRoleEvents: Array.from(document.querySelectorAll("#add-role-events .role-event-pill[data-event-type]")),
  rolesList: document.getElementById("roles-list"),
  rolesCount: document.getElementById("roles-count"),
  rolesActiveSummary: document.getElementById("roles-active-summary"),
  presetRolesSummary: document.getElementById("preset-roles-summary"),
  gotoRolesTabBtn: document.getElementById("goto-roles-tab-btn"),
  tabBtnRoles: document.getElementById("tab-btn-roles"),
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

function timeoutSignal(ms) {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;
}

async function fetchRepoConfig() {
  const res = await fetch("./data/config.json", { signal: timeoutSignal(6000) });
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

function renderCustomChanges() {
  if (!els.customChangesList) return;
  const s = state.config.settings;
  const sorted = sortCustomChangeTimes(s.startTime || "22:00", s.endTime || "04:00", s.customChanges ?? []);
  s.customChanges = sorted;

  els.customChangesList.replaceChildren();
  for (const hhmm of sorted) {
    const li = document.createElement("li");
    li.className = "change-chip";
    const span = document.createElement("span");
    span.textContent = hhmm;
    const removeBtn = createRemoveButton(`Retirer le changement de ${hhmm}`, async () => {
      state.config.settings.customChanges = (state.config.settings.customChanges ?? []).filter((t) => t !== hhmm);
      renderCustomChanges();
      await saveAndAutoPublish();
    });
    li.append(span, removeBtn);
    els.customChangesList.appendChild(li);
  }
}

function updateSlotModeUi() {
  const isCustom = els.slotMode?.value === "custom";
  if (els.slotDurationWrap) els.slotDurationWrap.hidden = isCustom;
  if (els.customChangesWrap) els.customChangesWrap.hidden = !isCustom;
  if (els.slotDuration) els.slotDuration.required = !isCustom;
}

function normalizeEventType(value) {
  return Object.hasOwn(EVENT_TYPE_PRESETS, value) ? value : DEFAULT_EVENT_TYPE;
}

function updatePresetButtons(eventType) {
  const activeType = normalizeEventType(eventType);
  for (const btn of els.presetButtons) {
    btn.setAttribute("aria-pressed", String(btn.dataset.preset === activeType));
  }
}

function populateSettingsForm() {
  const s = state.config.settings;
  updatePresetButtons(s.eventType);
  els.eventName.value = s.eventName ?? "";
  els.startTime.value = s.startTime ?? "22:00";
  els.endTime.value = s.endTime ?? "04:00";
  if (els.slotMode) els.slotMode.value = s.slotMode === "custom" ? "custom" : "fixed";
  els.slotDuration.value = s.slotDuration ?? 45;
  updateSlotModeUi();
  renderCustomChanges();
  els.bus1Arrival.value = s.bus1Arrival ?? "22:30";
  els.bus2Arrival.value = s.bus2Arrival ?? "23:15";
  els.busStaffCount.value = s.busStaffCount ?? 2;
  els.busBuffer.value = s.busBufferMinutes ?? 0;
}

function syncSettingsFromForm() {
  const startTime = els.startTime.value;
  const endTime = els.endTime.value;
  const slotMode = els.slotMode?.value === "custom" ? "custom" : "fixed";
  state.config.settings = {
    ...state.config.settings,
    eventType: normalizeEventType(state.config.settings.eventType),
    eventName: els.eventName.value.trim(),
    startTime,
    endTime,
    slotMode,
    slotDuration: Number(els.slotDuration.value) || 45,
    customChanges: sortCustomChangeTimes(startTime, endTime, state.config.settings.customChanges ?? []),
    bus1Arrival: els.bus1Arrival.value,
    bus2Arrival: els.bus2Arrival.value,
    busStaffCount: Number(els.busStaffCount.value),
    busBufferMinutes: Number(els.busBuffer.value)
  };
}

async function applyEventTypePreset(presetKey) {
  const type = normalizeEventType(presetKey);
  const currentType = normalizeEventType(state.config.settings.eventType);
  if (type === currentType) {
    updatePresetButtons(type);
    return;
  }
  const preset = EVENT_TYPE_PRESETS[type];
  state.config.settings = {
    ...state.config.settings,
    eventType: type,
    eventName: preset.eventName,
    startTime: preset.startTime,
    endTime: preset.endTime,
    slotMode: preset.slotMode,
    slotDuration: preset.slotDuration,
    customChanges: [],
    bus1Arrival: preset.bus1Arrival,
    bus2Arrival: preset.bus2Arrival,
    busStaffCount: preset.busStaffCount,
    busBufferMinutes: preset.busBufferMinutes
  };
  populateSettingsForm();
  for (const input of els.settingsForm.querySelectorAll("input, select")) {
    syncFieldValidity(input, false, false);
  }
  syncAddRoleEventsUi([type]);
  renderRoles();
  state.seed = Date.now();
  await saveAndAutoPublish();
}

function populateBusSelectors() {
  const active = state.config.members
    .filter((m) => m.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
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

  for (const member of [...members].sort((a, b) =>
    a.name.localeCompare(b.name, "fr", { sensitivity: "base" })
  )) {
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

function getRoleEventTypes(role) {
  if (!Array.isArray(role.eventTypes)) return [...EVENT_TYPE_ORDER];
  return EVENT_TYPE_ORDER.filter((type) => role.eventTypes.includes(type));
}

function syncAddRoleEventsUi(selectedTypes) {
  const activeSet = new Set(selectedTypes);
  for (const btn of els.addRoleEvents) {
    btn.setAttribute("aria-pressed", String(activeSet.has(btn.dataset.eventType)));
  }
}

function renderRoles() {
  const roles = state.config.roles;
  const currentType = normalizeEventType(state.config.settings.eventType);
  const currentLabel = EVENT_TYPE_PRESETS[currentType].label;
  const activeRoles = [];
  const inactiveRoles = [];

  for (const role of roles) {
    if (getRoleEventTypes(role).includes(currentType)) {
      activeRoles.push(role);
    } else {
      inactiveRoles.push(role);
    }
  }

  const activeCount = activeRoles.length;
  const activeSeats = activeRoles.reduce((sum, r) => sum + (Number(r.countPerSlot) || 0), 0);
  els.rolesCount.textContent = activeCount === roles.length ? String(roles.length) : `${activeCount}/${roles.length}`;

  const summaryText = `${activeCount} staff${activeCount > 1 ? "s" : ""} · ${activeSeats} place${activeSeats > 1 ? "s" : ""}/rotation`;
  if (els.rolesActiveSummary) {
    els.rolesActiveSummary.textContent = summaryText;
  }
  if (els.presetRolesSummary) {
    els.presetRolesSummary.textContent = `${currentLabel} : ${summaryText}`;
  }

  els.rolesList.replaceChildren();

  const appendRoleItem = (role, isActiveForCurrent) => {
    const roleEventTypes = getRoleEventTypes(role);
    const hasNoEvent = roleEventTypes.length === 0;

    const li = document.createElement("li");
    li.className = `roster-item role-item${isActiveForCurrent ? "" : " is-inactive-for-event"}`;

    const mainRow = document.createElement("div");
    mainRow.className = "role-item-main";

    const titleGroup = document.createElement("div");
    titleGroup.className = "role-title-group";

    const nameSpan = document.createElement("span");
    nameSpan.className = "roster-name";
    nameSpan.textContent = role.name;
    titleGroup.appendChild(nameSpan);

    if (hasNoEvent) {
      const warnTag = document.createElement("span");
      warnTag.className = "role-status-tag role-status-tag-warn";
      warnTag.textContent = "Aucun évènement";
      titleGroup.appendChild(warnTag);
    } else if (!isActiveForCurrent) {
      const offTag = document.createElement("span");
      offTag.className = "role-status-tag";
      offTag.textContent = `Hors ${currentLabel}`;
      titleGroup.appendChild(offTag);
    }

    const countWrap = document.createElement("label");
    countWrap.className = "role-count-wrap";
    const multSpan = document.createElement("span");
    multSpan.setAttribute("aria-hidden", "true");
    multSpan.textContent = "×";

    const countInput = document.createElement("input");
    countInput.type = "number";
    countInput.min = "1";
    countInput.max = "10";
    countInput.value = String(role.countPerSlot);
    countInput.className = "role-count-input";
    countInput.setAttribute("aria-label", `Places par rotation pour ${role.name}`);
    countInput.setAttribute("aria-invalid", "false");
    countInput.addEventListener("change", async () => {
      const next = Math.max(1, Math.min(10, Number(countInput.value) || 1));
      role.countPerSlot = next;
      countInput.value = String(next);
      renderRoles();
      await saveAndAutoPublish();
    });

    countWrap.append(multSpan, countInput);

    const removeBtn = createRemoveButton(`Retirer le staff ${role.name}`, async () => {
      state.config.roles = state.config.roles.filter((r) => r.id !== role.id);
      renderRoles();
      await saveAndAutoPublish();
    });

    mainRow.append(titleGroup, countWrap, removeBtn);

    const eventsRow = document.createElement("div");
    eventsRow.className = "role-events";
    eventsRow.setAttribute("role", "group");
    eventsRow.setAttribute("aria-label", `Évènements associés à ${role.name}`);

    for (const type of EVENT_TYPE_ORDER) {
      const typeLabel = EVENT_TYPE_PRESETS[type].label;
      const isPressed = roleEventTypes.includes(type);
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = `role-event-pill${type === currentType ? " is-current-event" : ""}`;
      pill.textContent = typeLabel;
      pill.setAttribute("aria-label", `${typeLabel} (${role.name})`);
      pill.setAttribute("aria-pressed", String(isPressed));
      pill.addEventListener("click", async () => {
        const current = getRoleEventTypes(role);
        const next = current.includes(type)
          ? current.filter((t) => t !== type)
          : [...current, type];
        role.eventTypes = EVENT_TYPE_ORDER.filter((t) => next.includes(t));
        renderRoles();
        await saveAndAutoPublish();
      });
      eventsRow.appendChild(pill);
    }

    li.append(mainRow, eventsRow);
    els.rolesList.appendChild(li);
  };

  for (const role of activeRoles) {
    appendRoleItem(role, true);
  }

  if (inactiveRoles.length > 0) {
    const divider = document.createElement("li");
    divider.className = "role-group-divider";
    divider.setAttribute("role", "presentation");
    divider.textContent = `Non inclus dans ${currentLabel} (${inactiveRoles.length})`;
    els.rolesList.appendChild(divider);

    for (const role of inactiveRoles) {
      appendRoleItem(role, false);
    }
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
    ...(els.slotMode?.value === "custom" ? [] : [els.slotDuration]),
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
    if (els.summaryGrid) els.summaryGrid.replaceChildren();
  }
}

function renderScheduleResult(result) {
  const { settings, roles, buses, schedule, memberSummary, stats, warnings, errors } = result;
  const durationInfo =
    settings.slotMode === "custom"
      ? "changements personnalisés"
      : `staffs de ${settings.slotDuration} min`;
  els.scheduleSubtitle.textContent = `${settings.eventName} · ${settings.startTime} – ${settings.endTime} · ${durationInfo}`;
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
    ["Rotations", String(stats.totalSlots ?? totalSlots), ""],
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

  // Member summary (optional, removed on config.html)
  if (els.summaryGrid) {
    els.summaryGrid.replaceChildren();
  }
}

function exportScheduleXlsx() {
  if (!state.lastResult) return;
  const { settings, roles, buses, schedule, memberSummary } = state.lastResult;

  const planningRows = [
    ["Type", "Horaire", ...roles.map((r) => `${r.name} (×${r.countPerSlot})`)],
    ...buses.map((bus) => [
      bus.label,
      bus.arrivalTime,
      bus.members.map((m) => m.name).join(", ")
    ]),
    ...schedule.map((slot) => [
      "Créneau",
      slot.label,
      ...roles.map((r) =>
        (slot.assignments[r.id] ?? []).map((m) => (m ? m.name : "Non pourvu")).join(", ")
      )
    ])
  ];

  const memberRows = [
    ["Staffeur", "Arrivée", "Affectations", "Détail des créneaux"],
    ...memberSummary.map((item) => {
      const arrival = item.busNumber
        ? `Staff Bus ${item.busNumber} (${item.busArrivalTime})`
        : item.transport === "bus1"
          ? `Bus 1 (${settings.bus1Arrival})`
          : item.transport === "bus2"
            ? `Bus 2 (${settings.bus2Arrival})`
            : `Voiture (dès ${settings.startTime})`;
      const detail = item.shifts.map((s) => `${s.slotLabel} : ${s.roleName}`).join(" | ") || "Aucun créneau";
      return [item.name, arrival, item.totalDuties, detail];
    })
  ];

  const xlsxBytes = buildXlsxWorkbook([
    { name: "Planning", rows: planningRows },
    { name: "Staffeurs", rows: memberRows }
  ]);

  const blob = new Blob([xlsxBytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "planning-staff-bde.xlsx";
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
    headers: sbHeaders(anonKey),
    signal: timeoutSignal(8000)
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(supabaseErrorMessage("Lecture Supabase impossible", res.status, body));
  }
  const rows = await res.json();
  return rows[0] ?? null;
}

async function publishOnline({ url, anonKey }, password, payloadConfig = state.config, payloadSchedule = state.lastResult) {
  const res = await fetch(`${url}/rest/v1/rpc/save_bde_state`, {
    method: "POST",
    headers: sbHeaders(anonKey),
    signal: timeoutSignal(10000),
    body: JSON.stringify({ p_password: password, p_config: payloadConfig, p_schedule: payloadSchedule })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(supabaseErrorMessage("Connexion refusée", res.status, body));
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
          location.replace("./login.html");
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
  syncAddRoleEventsUi([normalizeEventType(state.config.settings.eventType)]);
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

  for (const btn of els.presetButtons) {
    btn.addEventListener("click", () => applyEventTypePreset(btn.dataset.preset));
  }

  if (els.gotoRolesTabBtn && els.tabBtnRoles) {
    els.gotoRolesTabBtn.addEventListener("click", () => {
      els.tabBtnRoles.click();
      els.tabBtnRoles.focus();
    });
  }

  els.settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!validateSettingsForm()) return;
    syncSettingsFromForm();
    renderCustomChanges();
    state.seed = Date.now();
    await saveAndAutoPublish();
  });

  if (els.slotMode) {
    els.slotMode.addEventListener("change", async () => {
      updateSlotModeUi();
      syncSettingsFromForm();
      renderCustomChanges();
      await saveAndAutoPublish();
    });
  }

  if (els.addChangeBtn && els.newChangeTime) {
    els.addChangeBtn.addEventListener("click", async () => {
      const val = els.newChangeTime.value;
      if (!val) {
        els.newChangeTime.focus();
        return;
      }
      const s = state.config.settings;
      const next = sortCustomChangeTimes(
        els.startTime.value || s.startTime,
        els.endTime.value || s.endTime,
        [...(s.customChanges ?? []), val]
      );
      s.customChanges = next;
      els.newChangeTime.value = "";
      renderCustomChanges();
      await saveAndAutoPublish();
    });
  }

  for (const input of els.settingsForm.querySelectorAll("input, select")) {
    input.addEventListener("input", () => {
      syncFieldValidity(input, false, false);
    });
    input.addEventListener("blur", () => {
      if (input.value && !input.checkValidity()) {
        syncFieldValidity(input, true, true);
      }
    });
    if (input.tagName === "SELECT" && input !== els.slotMode) {
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

  els.exportXlsxBtn.addEventListener("click", exportScheduleXlsx);

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

  for (const btn of els.addRoleEvents) {
    btn.addEventListener("click", () => {
      const pressed = btn.getAttribute("aria-pressed") === "true";
      btn.setAttribute("aria-pressed", String(!pressed));
    });
  }

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
    const currentType = normalizeEventType(state.config.settings.eventType);
    const selectedEvents = els.addRoleEvents
      .filter((btn) => btn.getAttribute("aria-pressed") === "true")
      .map((btn) => btn.dataset.eventType);
    const eventTypes = selectedEvents.length > 0 ? selectedEvents : [currentType];

    state.config.roles.push({
      id: `r-${Date.now().toString(36)}`,
      name,
      countPerSlot,
      eventTypes
    });
    els.newRoleName.value = "";
    els.newRoleCount.value = "1";
    syncAddRoleEventsUi([currentType]);
    renderRoles();
    await saveAndAutoPublish();
  });

  els.openSyncBtn.addEventListener("click", () => openSyncDialog());
  els.closeSyncBtn.addEventListener("click", () => els.syncDialog.close());
  els.downloadJsonBtn.addEventListener("click", downloadConfigJson);

  els.sbLogoutBtn.addEventListener("click", () => {
    setSavedPassword("");
    location.replace("./login.html");
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

  // 1. Render immediately from local cache if available (0ms startup)
  if (local) {
    state.config = local;
    applyLoadedConfig();
    runAndRenderSchedule();
    setStatus("Synchronisation...");
  }

  // 2. Fetch repo config.json and Supabase state in parallel instead of sequentially
  const repoPromise = fetchRepoConfig().catch(() => null);
  const sbInitial = getSupabaseSettings();
  const onlinePromise = sbInitial.url && sbInitial.anonKey ? fetchOnlineState(sbInitial).catch(() => null) : Promise.resolve(null);

  const repoConfig = await repoPromise;
  if (repoConfig) {
    if (!state.config || isLocalhost) {
      state.config = repoConfig;
      if (!local || isLocalhost) {
        applyLoadedConfig();
        runAndRenderSchedule();
      }
    }
    if (!state.config.supabase) state.config.supabase = repoConfig.supabase;
  } else if (!local) {
    setStatus("Erreur config.json");
    return;
  }

  const sb = getSupabaseSettings();
  if (sb.url && sb.anonKey) {
    const online = await (sb.url === sbInitial.url && sb.anonKey === sbInitial.anonKey
      ? onlinePromise
      : fetchOnlineState(sb).catch(() => null));
    if (online) {
      loadOnline(online);
      return;
    }
    setStatus(isLocalhost ? "Local (config.json)" : "Hors ligne");
  } else {
    setStatus(isLocalhost ? "Local (config.json)" : "Prêt");
  }
}

init();
