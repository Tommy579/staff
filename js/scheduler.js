/**
 * Pure scheduling engine for BDE evening staff assignments.
 * Designed to run both in browser ES modules and Node.js tests.
 */

const MINUTES_PER_DAY = 1440;

/**
 * Normalizes a member's transport mode.
 * @param {string | undefined} value
 * @returns {"car" | "bus1" | "bus2"}
 */
export function normalizeTransport(value) {
  if (value === "bus1" || value === "bus2" || value === "car") {
    return value;
  }
  return "car";
}

/**
 * Parses "HH:MM" into minutes since 00:00.
 * @param {string} hhmm
 * @returns {number}
 */
export function parseTimeToMinutes(hhmm) {
  if (typeof hhmm !== "string" || !/^\d{2}:\d{2}$/.test(hhmm)) {
    throw new Error(`Heure invalide : "${hhmm}". Format attendu HH:MM.`);
  }
  const [hStr, mStr] = hhmm.split(":");
  const hours = Number(hStr);
  const minutes = Number(mStr);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Heure hors limites : "${hhmm}".`);
  }
  return hours * 60 + minutes;
}

/**
 * Formats an offset in minutes relative to party start back to "HH:MM".
 * @param {number} startMinutes
 * @param {number} offsetMinutes
 * @returns {string}
 */
export function formatOffsetTime(startMinutes, offsetMinutes) {
  const total = ((startMinutes + offsetMinutes) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = String(Math.floor(total / 60)).padStart(2, "0");
  const m = String(total % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Converts a clock time into an offset relative to party start.
 * For bus arrival times, values up to 180 minutes before startTime are treated as pre-start (negative offset).
 * @param {number} startMinutes
 * @param {string} hhmm
 * @param {{ allowPreStart?: boolean }} [options]
 * @returns {number}
 */
export function toRelativeOffset(startMinutes, hhmm, options = {}) {
  const raw = parseTimeToMinutes(hhmm);
  let diff = raw - startMinutes;
  if (options.allowPreStart) {
    if (diff < -180) {
      diff += MINUTES_PER_DAY;
    }
    return diff;
  }
  if (diff <= 0) {
    diff += MINUTES_PER_DAY;
  }
  return diff;
}

/**
 * Deterministic PRNG (Mulberry32) so tests and draws can be seeded or varied.
 * @param {number} seed
 * @returns {() => number}
 */
function createRng(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Sorts and deduplicates custom changeover times ("HH:MM") in ascending chronological order
 * relative to the party start/end window.
 * @param {string} startTime
 * @param {string} endTime
 * @param {string[]} times
 * @returns {string[]}
 */
export function sortCustomChangeTimes(startTime, endTime, times) {
  const startMin = parseTimeToMinutes(startTime);
  const totalDuration = toRelativeOffset(startMin, endTime, { allowPreStart: false });
  const uniqueOffsets = new Map();
  for (const t of times ?? []) {
    if (typeof t !== "string" || !/^\d{2}:\d{2}$/.test(t)) continue;
    const offset = toRelativeOffset(startMin, t, { allowPreStart: false });
    if (offset > 0 && offset < totalDuration && !uniqueOffsets.has(offset)) {
      uniqueOffsets.set(offset, formatOffsetTime(startMin, offset));
    }
  }
  return [...uniqueOffsets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, hhmm]) => hhmm);
}

/**
 * Builds the time slots for the evening (fixed duration or custom changeover times).
 */
export function buildTimeSlots(startTime, endTime, slotDuration, options = {}) {
  const startMin = parseTimeToMinutes(startTime);
  const totalDuration = toRelativeOffset(startMin, endTime, { allowPreStart: false });
  const slotMode = options.slotMode === "custom" ? "custom" : "fixed";

  if (slotMode === "custom") {
    const sortedTimes = sortCustomChangeTimes(startTime, endTime, options.customChanges ?? []);
    const boundaries = [0, ...sortedTimes.map((t) => toRelativeOffset(startMin, t, { allowPreStart: false })), totalDuration];
    const slots = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const startOffset = boundaries[i];
      const endOffset = boundaries[i + 1];
      slots.push({
        index: i,
        startOffset,
        endOffset,
        duration: endOffset - startOffset,
        isPartial: false,
        label: `${formatOffsetTime(startMin, startOffset)} - ${formatOffsetTime(startMin, endOffset)}`
      });
    }
    return { startMin, totalDuration, slots, slotMode, customChanges: sortedTimes };
  }

  const duration = Number(slotDuration);

  if (!Number.isInteger(duration) || duration < 10 || duration > 240) {
    throw new Error("La durée des staffs doit être comprise entre 10 et 240 minutes.");
  }

  const slots = [];
  let cursor = 0;
  let index = 0;
  while (cursor < totalDuration) {
    const next = Math.min(cursor + duration, totalDuration);
    const actualDuration = next - cursor;
    slots.push({
      index,
      startOffset: cursor,
      endOffset: next,
      duration: actualDuration,
      isPartial: actualDuration < duration,
      label: `${formatOffsetTime(startMin, cursor)} - ${formatOffsetTime(startMin, next)}`
    });
    cursor = next;
    index += 1;
  }

  return { startMin, totalDuration, slots, slotMode: "fixed", customChanges: [] };
}

/**
 * Generates a full schedule for the two buses and all evening staff slots.
 *
 * @param {Object} input
 * @param {Object} input.settings
 * @param {Array<{id: string, name: string, active: boolean}>} input.members
 * @param {Array<{id: string, name: string, countPerSlot: number}>} input.roles
 * @param {string[]} [input.bus1Manual]
 * @param {string[]} [input.bus2Manual]
 * @param {number} [input.seed]
 */
export function generateSchedule(input) {
  const settings = input?.settings ?? {};
  const eventType = typeof settings.eventType === "string" && settings.eventType ? settings.eventType : "soiree";
  const activeMembers = (input?.members ?? []).filter((m) => m && m.active !== false && m.name?.trim());
  const roles = (input?.roles ?? []).filter((r) => {
    if (!r || !r.name?.trim() || Number(r.countPerSlot) <= 0) return false;
    if (!Array.isArray(r.eventTypes)) return true;
    return r.eventTypes.includes(eventType);
  });

  if (roles.length === 0) {
    throw new Error("Ajoutez au moins un staff avec au moins 1 personne par rotation.");
  }

  const busStaffCount = Math.max(1, Number(settings.busStaffCount ?? 2));
  const busBufferMinutes = Math.max(0, Number(settings.busBufferMinutes ?? 0));
  const { startMin, totalDuration, slots, slotMode, customChanges } = buildTimeSlots(
    settings.startTime,
    settings.endTime,
    settings.slotDuration ?? 45,
    {
      slotMode: settings.slotMode,
      customChanges: settings.customChanges
    }
  );

  const bus1Offset = toRelativeOffset(startMin, settings.bus1Arrival, { allowPreStart: true });
  const bus2Offset = toRelativeOffset(startMin, settings.bus2Arrival, { allowPreStart: true });

  const warnings = [];
  const errors = [];

  if (slotMode === "fixed" && totalDuration % Number(settings.slotDuration ?? 45) !== 0) {
    const last = slots[slots.length - 1];
    warnings.push(
      `La durée totale (${totalDuration} min) n'est pas divisible par ${settings.slotDuration} min. La dernière rotation (${last.label}) dure ${last.duration} min.`
    );
  }

  const baseSeed = Number.isFinite(input?.seed) ? input.seed : Date.now();
  const memberById = new Map(activeMembers.map((m) => [m.id, m]));

  // Validate and resolve bus teams (no member in both buses).
  const bus1Ids = [];
  const bus2Ids = [];
  const usedBusIds = new Set();

  for (const id of input?.bus1Manual ?? []) {
    if (bus1Ids.length < busStaffCount && memberById.has(id) && !usedBusIds.has(id)) {
      bus1Ids.push(id);
      usedBusIds.add(id);
    }
  }
  for (const id of input?.bus2Manual ?? []) {
    if (bus2Ids.length < busStaffCount && memberById.has(id) && !usedBusIds.has(id)) {
      bus2Ids.push(id);
      usedBusIds.add(id);
    }
  }

  // Arrival blocking based on each member's declared transport mode.
  // "car" means present from the start of the evening; "bus1" / "bus2" means blocked before that bus arrives.
  const arrivalBlockedUntilByMember = new Map();
  for (const member of activeMembers) {
    const transport = normalizeTransport(member.transport);
    if (transport === "bus1") {
      arrivalBlockedUntilByMember.set(member.id, bus1Offset + busBufferMinutes);
    } else if (transport === "bus2") {
      arrivalBlockedUntilByMember.set(member.id, bus2Offset + busBufferMinutes);
    }
  }

  // Diagnostic checks before solving.
  const totalSeatsPerSlot = roles.reduce((sum, r) => sum + Number(r.countPerSlot), 0);
  if (activeMembers.length < totalSeatsPerSlot) {
    errors.push(
      `Effectif insuffisant : chaque créneau demande ${totalSeatsPerSlot} staffeurs mais seuls ${activeMembers.length} membres sont actifs.`
    );
  }
  if (activeMembers.length < busStaffCount * 2) {
    errors.push(
      `Il faut au moins ${busStaffCount * 2} membres actifs pour assurer les 2 bus (${busStaffCount} par bus).`
    );
  }

  // Check if any slot has fewer arrived/unblocked members than required seats.
  const carCount = activeMembers.filter((m) => normalizeTransport(m.transport) === "car").length;
  const bus1PassengerCount = activeMembers.filter((m) => normalizeTransport(m.transport) === "bus1").length;
  const bus2PassengerCount = activeMembers.filter((m) => normalizeTransport(m.transport) === "bus2").length;
  const extraBus1FromCar = Math.max(0, busStaffCount - bus1PassengerCount);
  const extraBus2FromCar = Math.max(0, busStaffCount - bus2PassengerCount);

  const conflictSlots = [];
  for (const s of slots) {
    const bus1Arrived = s.startOffset >= bus1Offset + busBufferMinutes;
    const bus2Arrived = s.startOffset >= bus2Offset + busBufferMinutes;
    let available = carCount;
    if (bus1Arrived) available += bus1PassengerCount;
    else available -= extraBus1FromCar;
    if (bus2Arrived) available += bus2PassengerCount;
    else available -= extraBus2FromCar;

    if (available < totalSeatsPerSlot) {
      conflictSlots.push({ label: s.label, available: Math.max(0, available) });
    }
  }
  if (conflictSlots.length > 0 && activeMembers.length >= totalSeatsPerSlot) {
    const first = conflictSlots[0];
    errors.push(
      `Conflit avant l'arrivée des bus (${conflictSlots.length} créneau(x), ex. ${first.label}) : seulement ${first.available} personne(s) arrivée(s) pour ${totalSeatsPerSlot} postes.`
    );
  }

  // Try up to 10 randomized restarts to pick the best complete (or highest-coverage) schedule.
  let bestResult = null;
  const maxAttempts = 10;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rng = createRng(baseSeed + attempt * 7919);
    const attemptBus1 = [...bus1Ids];
    const attemptBus2 = [...bus2Ids];
    const attemptUsedBus = new Set(usedBusIds);

    const bus1Pool = shuffleInPlace(
      activeMembers
        .filter((m) => !attemptUsedBus.has(m.id) && normalizeTransport(m.transport) === "bus1")
        .map((m) => m.id),
      rng
    );
    const bus2Pool = shuffleInPlace(
      activeMembers
        .filter((m) => !attemptUsedBus.has(m.id) && normalizeTransport(m.transport) === "bus2")
        .map((m) => m.id),
      rng
    );
    const carPool = shuffleInPlace(
      activeMembers
        .filter((m) => !attemptUsedBus.has(m.id) && normalizeTransport(m.transport) === "car")
        .map((m) => m.id),
      rng
    );

    const pickFrom = (pools, target, needed) => {
      for (const pool of pools) {
        while (target.length < needed && pool.length > 0) {
          const id = pool.shift();
          if (!attemptUsedBus.has(id)) {
            target.push(id);
            attemptUsedBus.add(id);
          }
        }
      }
    };

    pickFrom([bus1Pool, carPool, bus2Pool], attemptBus1, busStaffCount);
    pickFrom([bus2Pool, carPool, bus1Pool], attemptBus2, busStaffCount);

    const busInfoByMember = new Map();
    for (const id of attemptBus1) {
      busInfoByMember.set(id, { busNumber: 1, arrivalOffset: bus1Offset, blockedUntil: bus1Offset + busBufferMinutes });
    }
    for (const id of attemptBus2) {
      busInfoByMember.set(id, { busNumber: 2, arrivalOffset: bus2Offset, blockedUntil: bus2Offset + busBufferMinutes });
    }

    const solved = solveSlots({
      slots,
      roles,
      activeMembers,
      busInfoByMember,
      arrivalBlockedUntilByMember,
      rng
    });

    const candidate = {
      attemptBus1,
      attemptBus2,
      busInfoByMember,
      ...solved
    };

    if (!bestResult || isBetterSolution(candidate, bestResult)) {
      bestResult = candidate;
    }

    if (candidate.unfilledCount === 0 && candidate.backToBackCount === 0 && candidate.spread <= 1) {
      break;
    }
  }

  // Build final output structures.
  const buses = [
    {
      id: "bus-1",
      label: "Bus 1",
      arrivalTime: settings.bus1Arrival,
      arrivalOffset: bus1Offset,
      members: bestResult.attemptBus1.map((id) => memberById.get(id)).filter(Boolean)
    },
    {
      id: "bus-2",
      label: "Bus 2",
      arrivalTime: settings.bus2Arrival,
      arrivalOffset: bus2Offset,
      members: bestResult.attemptBus2.map((id) => memberById.get(id)).filter(Boolean)
    }
  ];

  const schedule = slots.map((slot, slotIdx) => {
    const assignments = {};
    for (const role of roles) {
      const ids = bestResult.grid[slotIdx][role.id] ?? [];
      assignments[role.id] = ids.map((id) => (id ? memberById.get(id) : null));
    }
    return {
      ...slot,
      assignments
    };
  });

  if (bestResult.unfilledCount > 0) {
    warnings.push(
      `${bestResult.unfilledCount} poste(s) n'ont pas pu être pourvus sans enfreindre la règle de non-répétition ou le blocage bus. Ajoutez des membres actifs ou des pôles de staff.`
    );
  }

  if (bestResult.backToBackCount > 0) {
    warnings.push(
      `${bestResult.backToBackCount} enchaînement(s) de deux créneaux consécutifs pour un même staffeur n'ont pas pu être évités faute d'effectif.`
    );
  }

  const memberSummary = activeMembers.map((member) => {
    const busInfo = bestResult.busInfoByMember.get(member.id) ?? null;
    const shifts = [];
    for (const slot of schedule) {
      for (const role of roles) {
        const assigned = slot.assignments[role.id] ?? [];
        if (assigned.some((m) => m && m.id === member.id)) {
          shifts.push({
            slotIndex: slot.index,
            slotLabel: slot.label,
            roleId: role.id,
            roleName: role.name
          });
        }
      }
    }
    const transport = normalizeTransport(member.transport);
    return {
      id: member.id,
      name: member.name,
      transport,
      busNumber: busInfo ? busInfo.busNumber : null,
      busArrivalTime: busInfo ? (busInfo.busNumber === 1 ? settings.bus1Arrival : settings.bus2Arrival) : null,
      shifts,
      totalDuties: shifts.length + (busInfo ? 1 : 0)
    };
  });

  return {
    settings: { ...settings, totalDuration, busStaffCount, busBufferMinutes, slotMode, customChanges },
    roles: roles.map((r) => ({ ...r, countPerSlot: Number(r.countPerSlot) })),
    buses,
    schedule,
    memberSummary,
    stats: {
      totalSlots: slots.length,
      totalSeats: slots.length * totalSeatsPerSlot,
      filledSeats: slots.length * totalSeatsPerSlot - bestResult.unfilledCount,
      unfilledCount: bestResult.unfilledCount,
      backToBackCount: bestResult.backToBackCount,
      spread: bestResult.spread
    },
    warnings,
    errors
  };
}

function isBetterSolution(a, b) {
  if (a.unfilledCount !== b.unfilledCount) {
    return a.unfilledCount < b.unfilledCount;
  }
  if (a.spread !== b.spread) {
    return a.spread < b.spread;
  }
  return a.backToBackCount < b.backToBackCount;
}

/**
 * Solves slot-role assignments with bounded backtracking and greedy fallback if infeasible.
 */
function solveSlots({ slots, roles, activeMembers, busInfoByMember, arrivalBlockedUntilByMember, rng }) {
  const memberIds = activeMembers.map((m) => m.id);
  const memberNoise = new Map(memberIds.map((id) => [id, rng()]));

  function getBlockedUntil(memberId) {
    const arrival = arrivalBlockedUntilByMember?.get(memberId) ?? -Infinity;
    const bus = busInfoByMember.get(memberId)?.blockedUntil ?? -Infinity;
    return Math.max(arrival, bus);
  }

  // Build ordered list of seat requirements.
  // Order slots with fewer available candidates first (typically early slots blocked by buses), then chronologically.
  const slotMeta = slots.map((slot, slotIdx) => {
    const availableCount = memberIds.filter((id) => slot.startOffset >= getBlockedUntil(id)).length;
    return { slotIdx, availableCount };
  });

  const sortedSlotIndices = [...slotMeta]
    .sort((a, b) => a.availableCount - b.availableCount || a.slotIdx - b.slotIdx)
    .map((item) => item.slotIdx);

  const tasks = [];
  for (const slotIdx of sortedSlotIndices) {
    // Larger roles first inside each slot to reduce late conflicts.
    const sortedRoles = [...roles].sort((a, b) => Number(b.countPerSlot) - Number(a.countPerSlot));
    for (const role of sortedRoles) {
      const count = Number(role.countPerSlot);
      for (let seatIdx = 0; seatIdx < count; seatIdx++) {
        tasks.push({ slotIdx, roleId: role.id, seatIdx });
      }
    }
  }

  // State tracking.
  const grid = slots.map(() => {
    const row = {};
    for (const role of roles) {
      row[role.id] = Array(Number(role.countPerSlot)).fill(null);
    }
    return row;
  });

  const assignedInSlot = slots.map(() => new Set());
  const usedRolesByMember = new Map(memberIds.map((id) => [id, new Set()]));
  const shiftLoadByMember = new Map(
    memberIds.map((id) => [id, busInfoByMember.has(id) ? 1 : 0])
  );

  function isEligible(memberId, slotIdx, roleId) {
    if (assignedInSlot[slotIdx].has(memberId)) {
      return false;
    }
    if (usedRolesByMember.get(memberId).has(roleId)) {
      return false;
    }
    if (slots[slotIdx].startOffset < getBlockedUntil(memberId)) {
      return false;
    }
    return true;
  }

  function hasAdjacentShift(memberId, slotIdx) {
    const prev = slotIdx > 0 && assignedInSlot[slotIdx - 1].has(memberId);
    const next = slotIdx + 1 < slots.length && assignedInSlot[slotIdx + 1].has(memberId);
    return prev || next;
  }

  function rankCandidates(slotIdx, roleId) {
    const candidates = memberIds.filter((id) => isEligible(id, slotIdx, roleId));
    candidates.sort((a, b) => {
      const loadDiff = shiftLoadByMember.get(a) - shiftLoadByMember.get(b);
      if (loadDiff !== 0) return loadDiff;

      const adjA = hasAdjacentShift(a, slotIdx) ? 1 : 0;
      const adjB = hasAdjacentShift(b, slotIdx) ? 1 : 0;
      if (adjA !== adjB) return adjA - adjB;

      // Prefer assigning members who have already used fewer distinct roles?
      // Actually, tie-break with precomputed random noise for fair variety.
      return memberNoise.get(a) - memberNoise.get(b);
    });
    return candidates;
  }

  let steps = 0;
  const maxSteps = 25000;
  let solvedFully = false;

  function backtrack(taskIndex) {
    if (taskIndex >= tasks.length) {
      solvedFully = true;
      return true;
    }
    steps += 1;
    if (steps > maxSteps) {
      return false;
    }

    const { slotIdx, roleId, seatIdx } = tasks[taskIndex];
    const candidates = rankCandidates(slotIdx, roleId);
    // Limit branching width at deep levels to keep search fast.
    const branchLimit = Math.min(candidates.length, 6);

    for (let i = 0; i < branchLimit; i++) {
      const memberId = candidates[i];
      grid[slotIdx][roleId][seatIdx] = memberId;
      assignedInSlot[slotIdx].add(memberId);
      usedRolesByMember.get(memberId).add(roleId);
      shiftLoadByMember.set(memberId, shiftLoadByMember.get(memberId) + 1);

      if (backtrack(taskIndex + 1)) {
        return true;
      }

      grid[slotIdx][roleId][seatIdx] = null;
      assignedInSlot[slotIdx].delete(memberId);
      usedRolesByMember.get(memberId).delete(roleId);
      shiftLoadByMember.set(memberId, shiftLoadByMember.get(memberId) - 1);

      if (steps > maxSteps) {
        return false;
      }
    }
    return false;
  }

  backtrack(0);

  // If complete backtracking failed or timed out, perform greedy best-effort filling leaving impossible seats null.
  if (!solvedFully) {
    // Reset and fill greedily in chronological order so early/late slots stay readable.
    for (let s = 0; s < slots.length; s++) {
      for (const role of roles) {
        grid[s][role.id].fill(null);
      }
      assignedInSlot[s].clear();
    }
    for (const id of memberIds) {
      usedRolesByMember.get(id).clear();
      shiftLoadByMember.set(id, busInfoByMember.has(id) ? 1 : 0);
    }

    for (let s = 0; s < slots.length; s++) {
      for (const role of roles) {
        const count = Number(role.countPerSlot);
        for (let seatIdx = 0; seatIdx < count; seatIdx++) {
          const candidates = rankCandidates(s, role.id);
          if (candidates.length > 0) {
            const picked = candidates[0];
            grid[s][role.id][seatIdx] = picked;
            assignedInSlot[s].add(picked);
            usedRolesByMember.get(picked).add(role.id);
            shiftLoadByMember.set(picked, shiftLoadByMember.get(picked) + 1);
          }
        }
      }
    }
  }

  let unfilledCount = 0;
  for (let s = 0; s < slots.length; s++) {
    for (const role of roles) {
      for (const occupant of grid[s][role.id]) {
        if (!occupant) unfilledCount += 1;
      }
    }
  }

  let backToBackCount = 0;
  for (let s = 1; s < slots.length; s++) {
    for (const id of assignedInSlot[s]) {
      if (assignedInSlot[s - 1].has(id)) {
        backToBackCount += 1;
      }
    }
  }

  const loads = memberIds.map((id) => shiftLoadByMember.get(id));
  const minLoad = loads.length > 0 ? Math.min(...loads) : 0;
  const maxLoad = loads.length > 0 ? Math.max(...loads) : 0;

  return {
    grid,
    unfilledCount,
    backToBackCount,
    spread: maxLoad - minLoad
  };
}
