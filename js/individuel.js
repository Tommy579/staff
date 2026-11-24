import { initReadOnlySync } from "./readonly-sync.js";

const statusEl = document.getElementById("readonly-status");
const subtitleEl = document.getElementById("schedule-subtitle");
const pickerViewEl = document.getElementById("member-picker-view");
const listEl = document.getElementById("individual-list");
const detailViewEl = document.getElementById("member-detail-view");
const detailNameEl = document.getElementById("detail-name");
const detailArrivalEl = document.getElementById("detail-arrival");
const detailShiftsEl = document.getElementById("detail-shifts");
const backBtn = document.getElementById("back-to-list-btn");
const updatedNoteEl = document.getElementById("last-updated-note");

let latestResult = null;
let selectedMemberId = new URLSearchParams(location.search).get("member") || "";

function setStatus(text, tone) {
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

function selectMember(memberId) {
  selectedMemberId = memberId;
  const url = new URL(location.href);
  if (memberId) url.searchParams.set("member", memberId);
  else url.searchParams.delete("member");
  history.replaceState(null, "", url);
  renderCurrentView();
}

function renderCurrentView() {
  if (!latestResult) return;
  const { settings, memberSummary } = latestResult;
  subtitleEl.textContent = `${settings.eventName} · ${settings.startTime} – ${settings.endTime}`;

  const selected = selectedMemberId
    ? memberSummary.find((m) => m.id === selectedMemberId)
    : null;

  if (selected) {
    pickerViewEl.hidden = true;
    detailViewEl.hidden = false;
    detailNameEl.textContent = selected.name;

    if (selected.busNumber) {
      detailArrivalEl.textContent = `Staff Bus ${selected.busNumber} · Arrivée ${selected.busArrivalTime}`;
    } else if (selected.transport === "bus1") {
      detailArrivalEl.textContent = `Arrivée Bus 1 · ${settings.bus1Arrival}`;
    } else if (selected.transport === "bus2") {
      detailArrivalEl.textContent = `Arrivée Bus 2 · ${settings.bus2Arrival}`;
    } else {
      detailArrivalEl.textContent = `Voiture · présent dès ${settings.startTime}`;
    }

    detailShiftsEl.replaceChildren();
    if (selected.busNumber) {
      const li = document.createElement("li");
      li.className = "detail-shift-item detail-shift-bus";
      const time = document.createElement("span");
      time.className = "detail-shift-time";
      time.textContent = selected.busArrivalTime;
      const role = document.createElement("span");
      role.className = "detail-shift-role";
      role.textContent = `Encadrement Bus ${selected.busNumber}`;
      li.append(time, role);
      detailShiftsEl.appendChild(li);
    }

    for (const shift of selected.shifts) {
      const li = document.createElement("li");
      li.className = "detail-shift-item";
      const time = document.createElement("span");
      time.className = "detail-shift-time";
      time.textContent = shift.slotLabel;
      const role = document.createElement("span");
      role.className = "detail-shift-role";
      role.textContent = shift.roleName;
      li.append(time, role);
      detailShiftsEl.appendChild(li);
    }

    if (!selected.busNumber && selected.shifts.length === 0) {
      const li = document.createElement("li");
      li.className = "hint";
      li.textContent = "Aucun créneau attribué pour cette soirée.";
      detailShiftsEl.appendChild(li);
    }
    return;
  }

  detailViewEl.hidden = true;
  pickerViewEl.hidden = false;
  listEl.replaceChildren();

  const sorted = [...memberSummary].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  for (const item of sorted) {
    const li = document.createElement("li");
    li.className = "individual-row";

    const info = document.createElement("div");
    info.className = "individual-info";
    const name = document.createElement("span");
    name.className = "individual-name";
    name.textContent = item.name;
    const meta = document.createElement("span");
    meta.className = "hint";
    meta.textContent = `${item.totalDuties} créneau(x)`;
    info.append(name, meta);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary btn-sm";
    btn.textContent = "Consulter";
    btn.addEventListener("click", () => selectMember(item.id));

    li.append(info, btn);
    listEl.appendChild(li);
  }
}

backBtn.addEventListener("click", () => selectMember(""));

initReadOnlySync({
  onData: (result, { updatedAt }) => {
    latestResult = result;
    if (updatedAt) {
      updatedNoteEl.textContent = `Mis à jour le ${new Date(updatedAt).toLocaleString("fr-FR")}`;
    }
    renderCurrentView();
  },
  onStatus: setStatus
});
