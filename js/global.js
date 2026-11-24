import { initReadOnlySync } from "./readonly-sync.js";

const statusEl = document.getElementById("readonly-status");
const subtitleEl = document.getElementById("schedule-subtitle");
const busStripEl = document.getElementById("bus-strip");
const theadEl = document.getElementById("schedule-thead");
const tbodyEl = document.getElementById("schedule-tbody");
const updatedNoteEl = document.getElementById("last-updated-note");

function setStatus(text, tone) {
  statusEl.textContent = text;
  statusEl.dataset.tone = tone;
}

function renderGlobalSchedule(result, { updatedAt }) {
  const { settings, roles, buses, schedule } = result;
  subtitleEl.textContent = `${settings.eventName} · ${settings.startTime} – ${settings.endTime}`;

  if (updatedAt) {
    updatedNoteEl.textContent = `Mis à jour le ${new Date(updatedAt).toLocaleString("fr-FR")}`;
  }

  busStripEl.replaceChildren();
  for (const bus of buses) {
    const card = document.createElement("div");
    card.className = "bus-card";

    const head = document.createElement("div");
    head.className = "bus-card-head";
    const title = document.createElement("strong");
    title.textContent = bus.label;
    const time = document.createElement("span");
    time.className = "bus-time";
    time.textContent = bus.arrivalTime;
    head.append(title, time);

    const list = document.createElement("div");
    list.className = "bus-staff-list";
    for (const member of bus.members) {
      const chip = document.createElement("span");
      chip.className = "member-chip member-chip-bus";
      chip.textContent = member.name;
      list.appendChild(chip);
    }

    card.append(head, list);
    busStripEl.appendChild(card);
  }

  theadEl.replaceChildren();
  const headRow = document.createElement("tr");
  const cornerTh = document.createElement("th");
  cornerTh.scope = "col";
  cornerTh.textContent = "Horaire";
  headRow.appendChild(cornerTh);

  for (const role of roles) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = role.name;
    headRow.appendChild(th);
  }
  theadEl.appendChild(headRow);

  tbodyEl.replaceChildren();
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
    rowTh.append(startEl, endEl);
    tr.appendChild(rowTh);

    for (const role of roles) {
      const td = document.createElement("td");
      td.style.setProperty("--cell-label", JSON.stringify(role.name));
      const wrap = document.createElement("div");
      wrap.className = "cell-occupants";

      for (const person of slot.assignments[role.id] ?? []) {
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
    tbodyEl.appendChild(tr);
  }
}

initReadOnlySync({
  onData: renderGlobalSchedule,
  onStatus: setStatus
});
