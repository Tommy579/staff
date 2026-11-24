import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateSchedule } from "../js/scheduler.js";

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

// 1. Check 2 buses with 2 distinct people each (4 distinct total)
assert.equal(result.buses.length, 2);
const bus1Ids = result.buses[0].members.map((m) => m.id);
const bus2Ids = result.buses[1].members.map((m) => m.id);
assert.equal(bus1Ids.length, 2, "Bus 1 must have 2 staffers");
assert.equal(bus2Ids.length, 2, "Bus 2 must have 2 staffers");
assert.equal(new Set([...bus1Ids, ...bus2Ids]).size, 4, "4 distinct people across both buses");

// 2. Check all seats filled with valid config
assert.equal(result.stats.unfilledCount, 0, "Default config should fill all seats");

// 3. Check bus arrival rule: bus staff cannot work slots starting strictly before their bus arrives
for (const slot of result.schedule) {
  for (const role of result.roles) {
    const assigned = slot.assignments[role.id];
    for (const member of assigned) {
      assert.ok(member, `Unfilled seat in ${slot.label} / ${role.name}`);
      if (bus1Ids.includes(member.id)) {
        assert.ok(
          slot.startOffset >= result.buses[0].arrivalOffset,
          `${member.name} (Bus 1) assigned before bus 1 arrival on ${slot.label}`
        );
      }
      if (bus2Ids.includes(member.id)) {
        assert.ok(
          slot.startOffset >= result.buses[1].arrivalOffset,
          `${member.name} (Bus 2) assigned before bus 2 arrival on ${slot.label}`
        );
      }
    }
  }
}

// 4. Check no member works two roles in the same slot, and no member repeats a role in the evening
for (const slot of result.schedule) {
  const seenInSlot = new Set();
  for (const role of result.roles) {
    for (const member of slot.assignments[role.id]) {
      assert.equal(seenInSlot.has(member.id), false, `${member.name} double-booked in slot ${slot.label}`);
      seenInSlot.add(member.id);
    }
  }
}

for (const summary of result.memberSummary) {
  const roleIds = summary.shifts.map((s) => s.roleId);
  assert.equal(
    new Set(roleIds).size,
    roleIds.length,
    `${summary.name} repeated a role in the evening`
  );
}

// 5. Check midnight crossing (22:00 -> 04:00 = 360 min = 8 slots of 45 min)
assert.equal(result.schedule.length, 8, "22:00 to 04:00 with 45 min slots = 8 slots");
assert.equal(result.schedule[0].label, "22:00 - 22:45");
assert.equal(result.schedule[7].label, "03:15 - 04:00");

console.log("OK: All scheduler constraints verified (8 slots, 2 buses, 0 repeats, 0 early bus conflicts).");
