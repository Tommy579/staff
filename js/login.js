import { normalizeSupabaseUrl, supabaseErrorMessage } from "./supabase-url.js";

const CONFIG_STORAGE_KEY = "bde_staff_auto_config_v1";
const SB_SETTINGS_KEY = "bde_staff_auto_sb_v1";
const SB_PASSWORD_COOKIE = "bde_staff_auto_pwd";
const SB_COOKIE_DAYS = 30;

const form = document.getElementById("login-form");
const passwordInput = document.getElementById("login-password");
const feedback = document.getElementById("login-feedback");
const submitBtn = document.getElementById("login-submit-btn");

function setSavedPassword(value) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  const maxAge = 60 * 60 * 24 * SB_COOKIE_DAYS;
  document.cookie = `${SB_PASSWORD_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax${secure}`;
}

function timeoutSignal(ms) {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;
}

function sbHeaders(anonKey) {
  const headers = { apikey: anonKey, "Content-Type": "application/json" };
  if (anonKey.startsWith("eyJ")) headers.Authorization = `Bearer ${anonKey}`;
  return headers;
}

async function getSupabaseConfig() {
  let savedSb = {};
  try {
    savedSb = JSON.parse(localStorage.getItem(SB_SETTINGS_KEY) || "{}");
  } catch {
    savedSb = {};
  }

  let repoConfig = null;
  try {
    const res = await fetch("./data/config.json", { signal: timeoutSignal(6000) });
    if (res.ok) repoConfig = await res.json();
  } catch {
    // Ignore fetch error if localStorage already has config.
  }

  let localConfig = null;
  try {
    localConfig = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || "null");
  } catch {
    localConfig = null;
  }

  const baseConfig = localConfig || repoConfig;
  const fromRepo = baseConfig?.supabase ?? repoConfig?.supabase ?? {};
  return {
    baseConfig,
    url: normalizeSupabaseUrl(savedSb.url || fromRepo.url || ""),
    anonKey: savedSb.anonKey || fromRepo.anonKey || ""
  };
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = passwordInput.value;
  if (!password) {
    passwordInput.setAttribute("aria-invalid", "true");
    feedback.textContent = "Entrez le mot de passe BDE.";
    passwordInput.focus();
    return;
  }

  passwordInput.setAttribute("aria-invalid", "false");
  submitBtn.disabled = true;
  feedback.textContent = "Vérification...";

  try {
    const { baseConfig, url, anonKey } = await getSupabaseConfig();
    if (!url || !anonKey) {
      throw new Error("Configuration Supabase manquante.");
    }

    // Read existing online state first so logging in never overwrites published schedule
    let online = null;
    try {
      const getRes = await fetch(`${url}/rest/v1/bde_state?id=eq.main&select=config,schedule,updated_at`, {
        headers: sbHeaders(anonKey),
        signal: timeoutSignal(8000)
      });
      if (getRes.ok) {
        const rows = await getRes.json();
        online = rows[0] ?? null;
      }
    } catch {
      online = null;
    }

    const payloadConfig = online?.config ?? baseConfig;
    const payloadSchedule = online?.schedule ?? null;

    const res = await fetch(`${url}/rest/v1/rpc/save_bde_state`, {
      method: "POST",
      headers: sbHeaders(anonKey),
      signal: timeoutSignal(10000),
      body: JSON.stringify({
        p_password: password,
        p_config: payloadConfig,
        p_schedule: payloadSchedule
      })
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(supabaseErrorMessage("Connexion refusée", res.status, body));
    }

    if (online?.config) {
      try {
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(online.config));
      } catch {
        // Ignore storage quota errors.
      }
    }
    setSavedPassword(password);
    location.replace("./index.html");
  } catch (err) {
    feedback.textContent = err.message;
    passwordInput.focus();
    submitBtn.disabled = false;
  }
});
