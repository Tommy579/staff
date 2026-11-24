import assert from "node:assert/strict";
import { normalizeSupabaseUrl, isSupabaseProjectUrl, supabaseErrorMessage } from "../js/supabase-url.js";

// 1. URL de base : inchangee.
assert.equal(normalizeSupabaseUrl("https://abc.supabase.co"), "https://abc.supabase.co");

// 2. Suffixe /rest/v1 colle depuis l'API docs : supprime (bug du double prefixe).
assert.equal(normalizeSupabaseUrl("https://abc.supabase.co/rest/v1/"), "https://abc.supabase.co");
assert.equal(normalizeSupabaseUrl("https://abc.supabase.co/rest/v1"), "https://abc.supabase.co");

// 3. Slash, espaces, casse et query string.
assert.equal(normalizeSupabaseUrl("  https://abc.supabase.co///  "), "https://abc.supabase.co");
assert.equal(normalizeSupabaseUrl("https://abc.supabase.co/REST/V1/"), "https://abc.supabase.co");
assert.equal(normalizeSupabaseUrl("https://abc.supabase.co/?apikey=x"), "https://abc.supabase.co");
assert.equal(normalizeSupabaseUrl(""), "");
assert.equal(normalizeSupabaseUrl(undefined), "");

// 4. Validation du format attendu.
assert.equal(isSupabaseProjectUrl("https://abc-123.supabase.co"), true);
assert.equal(isSupabaseProjectUrl("https://abc.supabase.co/rest/v1"), false);
assert.equal(isSupabaseProjectUrl("http://abc.supabase.co"), false);
assert.equal(isSupabaseProjectUrl("https://supabase.com/dashboard/project/abc"), false);

// 5. Messages d'erreur explicites pour les 404 PostgREST.
const missingTable = supabaseErrorMessage("Lecture Supabase impossible", 404, {
  code: "PGRST205",
  message: "Could not find the table 'public.bde_state' in the schema cache"
});
assert.match(missingTable, /HTTP 404/);
assert.match(missingTable, /schema\.sql/);
assert.match(supabaseErrorMessage("Publication refusee", 404, { code: "PGRST202" }), /save_bde_state/);
assert.match(supabaseErrorMessage("Lecture Supabase impossible", 401, {}), /HTTP 401/);

console.log("supabase-url: OK");