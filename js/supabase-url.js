// Helpers Supabase partages entre l'interface et les tests.

// Accepte "https://xxx.supabase.co", ".../rest/v1", ".../rest/v1/" (copie depuis
// l'API docs) et renvoie toujours l'URL de base du projet, sans slash final.
export function normalizeSupabaseUrl(raw) {
  let url = String(raw ?? "").trim().replace(/\s+/g, "");
  if (!url) return "";
  url = url.replace(/[?#].*$/, "");
  url = url.replace(/\/+$/, "");
  url = url.replace(/\/rest\/v1$/i, "");
  url = url.replace(/\/+$/, "");
  return url;
}

export function isSupabaseProjectUrl(url) {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url);
}

export function supabaseErrorHint(code) {
  switch (code) {
    case "PGRST205":
    case "42P01":
      return "Table public.bde_state absente : collez supabase/schema.sql dans le SQL Editor du projet puis Run.";
    case "PGRST202":
      return "Fonction save_bde_state absente : collez supabase/schema.sql dans le SQL Editor du projet puis Run.";
    case "PGRST125":
      return "URL Supabase invalide : utilisez seulement https://xxxx.supabase.co.";
    case "PGRST301":
    case "401":
      return "Cle anon refusee : verifiez la cle publique du projet (pas la cle service_role).";
    case "28P01":
      return "Mot de passe BDE incorrect.";
    default:
      return "";
  }
}

export function supabaseErrorMessage(prefix, status, body) {
  const code = body?.code ? String(body.code) : "";
  const detail = body?.message ? ` ${body.message}.` : "";
  const hint = supabaseErrorHint(code) || supabaseErrorHint(String(status));
  const suffix = hint ? ` ${hint}` : "";
  return `${prefix} (HTTP ${status}).${detail}${suffix}`.replace(/\.\./g, ".");
}