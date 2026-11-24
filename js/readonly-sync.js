import { generateSchedule } from "./scheduler.js";
import { normalizeSupabaseUrl } from "./supabase-url.js";

const CONFIG_STORAGE_KEY = "bde_staff_auto_config_v1";
const ONLINE_CACHE_KEY = "bde_staff_auto_online_v1";
const SB_SETTINGS_KEY = "bde_staff_auto_sb_v1";
const POLL_INTERVAL_MS = 15000;

function timeoutSignal(ms) {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;
}

function safeReadJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeWriteJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota errors.
  }
}

function sbHeaders(anonKey) {
  const headers = { apikey: anonKey, "Content-Type": "application/json" };
  if (anonKey.startsWith("eyJ")) headers.Authorization = `Bearer ${anonKey}`;
  return headers;
}

function getSupabaseSettings(repoConfig) {
  const saved = safeReadJson(SB_SETTINGS_KEY) ?? {};
  const fromRepo = repoConfig?.supabase ?? {};
  return {
    url: normalizeSupabaseUrl(saved.url || fromRepo.url || ""),
    anonKey: saved.anonKey || fromRepo.anonKey || ""
  };
}

function computeScheduleFromConfig(config) {
  if (!config?.settings || !Array.isArray(config.members) || !Array.isArray(config.roles)) {
    return null;
  }
  return generateSchedule({
    settings: config.settings,
    members: config.members,
    roles: config.roles,
    seed: 1
  });
}

/**
 * Initializes a read-only planning page with instant cache rendering and automatic Supabase polling.
 * @param {{ onData: (result: object, meta: { updatedAt: string | null }) => void, onStatus: (text: string, tone: string) => void }} handlers
 */
export async function initReadOnlySync({ onData, onStatus }) {
  let repoConfig = null;
  let lastUpdatedAt = null;
  let polling = false;

  const cachedOnline = safeReadJson(ONLINE_CACHE_KEY);
  const cachedConfig = safeReadJson(CONFIG_STORAGE_KEY);

  if (cachedOnline?.schedule?.schedule) {
    lastUpdatedAt = cachedOnline.updated_at ?? null;
    onData(cachedOnline.schedule, { updatedAt: lastUpdatedAt });
    onStatus("Actualisation...", "busy");
  } else if (cachedConfig) {
    const fallback = computeScheduleFromConfig(cachedConfig);
    if (fallback) onData(fallback, { updatedAt: null });
    onStatus("Actualisation...", "busy");
  }

  try {
    const res = await fetch("./data/config.json", { signal: timeoutSignal(6000) });
    if (res.ok) repoConfig = await res.json();
  } catch {
    repoConfig = null;
  }

  if (!cachedOnline && !cachedConfig && repoConfig) {
    const fallback = computeScheduleFromConfig(repoConfig);
    if (fallback) onData(fallback, { updatedAt: null });
  }

  const sb = getSupabaseSettings(repoConfig || cachedConfig);

  async function refreshFromSupabase() {
    if (polling || !sb.url || !sb.anonKey) return;
    if (document.visibilityState === "hidden") return;
    polling = true;
    try {
      const res = await fetch(`${sb.url}/rest/v1/bde_state?id=eq.main&select=config,schedule,updated_at`, {
        headers: sbHeaders(sb.anonKey),
        signal: timeoutSignal(8000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      const online = rows[0] ?? null;

      if (online) {
        const changed = online.updated_at !== lastUpdatedAt;
        lastUpdatedAt = online.updated_at ?? null;
        safeWriteJson(ONLINE_CACHE_KEY, online);
        if (online.config) safeWriteJson(CONFIG_STORAGE_KEY, online.config);
        const scheduleData = online.schedule?.schedule
          ? online.schedule
          : computeScheduleFromConfig(online.config);
        if (scheduleData && (changed || !cachedOnline)) {
          onData(scheduleData, { updatedAt: lastUpdatedAt });
        }
        onStatus("En direct", "ok");
      } else {
        onStatus("Aucun planning publié", "idle");
      }
    } catch {
      onStatus("Hors ligne", "bad");
    } finally {
      polling = false;
    }
  }

  if (sb.url && sb.anonKey) {
    await refreshFromSupabase();
    setInterval(refreshFromSupabase, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        refreshFromSupabase();
      }
    });
  } else {
    onStatus("Mode local", "idle");
  }
}
