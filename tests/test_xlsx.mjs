import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateSchedule } from "../js/scheduler.js";
import { buildXlsxWorkbook } from "../js/xlsx.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "config.json"), "utf8")
);

const result = generateSchedule({
  settings: config.settings,
  members: config.members,
  roles: config.roles,
  seed: 42
});

const bytes = buildXlsxWorkbook([
  {
    name: "Planning",
    rows: [
      ["Type", "Horaire", ...result.roles.map((r) => r.name)],
      ...result.buses.map((b) => [b.label, b.arrivalTime, b.members.map((m) => m.name).join(", ")]),
      ...result.schedule.map((slot) => [
        "Créneau",
        slot.label,
        ...result.roles.map((r) => (slot.assignments[r.id] ?? []).map((m) => (m ? m.name : "Non pourvu")).join(", "))
      ])
    ]
  },
  {
    name: "Staffeurs",
    rows: [
      ["Nom", "Arrivée", "Missions"],
      ...result.memberSummary.map((m) => [m.name, m.transport, m.totalDuties])
    ]
  }
]);

assert.ok(bytes instanceof Uint8Array);
assert.equal(bytes[0], 0x50); // 'P'
assert.equal(bytes[1], 0x4b); // 'K'
assert.equal(bytes[2], 0x03);
assert.equal(bytes[3], 0x04);

const text = new TextDecoder("latin1").decode(bytes);
assert.ok(text.includes("xl/workbook.xml"));
assert.ok(text.includes("xl/worksheets/sheet1.xml"));
assert.ok(text.includes("xl/worksheets/sheet2.xml"));
assert.ok(text.includes("Planning"));
assert.ok(text.includes("Staffeurs"));

console.log(`OK: XLSX workbook generated (${bytes.length} bytes, 2 sheets, valid ZIP structure).`);
