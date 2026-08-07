// Tartalom Stúdió — fájlfeltöltés szerveroldali végpontjai.
// A böngésző NEM kap service kulcsot: a szerver ad egy egyszer használatos,
// aláírt feltöltési linket a privát "content-media" tárhelyre.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MEDIA_BUCKET, safeMediaName } from "@/lib/content-media";

/** Aláírt feltöltési link kérése — a böngésző erre tölti fel a fájlt. */
export const createMediaUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { file_name: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    const tenantId = prof?.tenant_id;
    if (!tenantId) throw new Error("tenant_id hiányzik a profilodhoz.");
    const path = `${tenantId}/${crypto.randomUUID()}-${safeMediaName(data.file_name)}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from(MEDIA_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Nem sikerült feltöltési linket kérni.");
    return { path, token: signed.token, signed_url: signed.signedUrl, bucket: MEDIA_BUCKET };
  });

/** Előnézeti / letöltési link egy már feltöltött fájlhoz. */
export const createMediaViewUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { path: string; expires_in?: number }) => d)
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (!prof?.tenant_id || !data.path.startsWith(`${prof.tenant_id}/`)) {
      throw new Error("Nincs jogosultság ehhez a fájlhoz.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(data.path, data.expires_in ?? 3600);
    if (error || !signed) throw new Error(error?.message ?? "Nem sikerült linket készíteni.");
    return { url: signed.signedUrl };
  });
