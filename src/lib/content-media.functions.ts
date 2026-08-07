// Tartalom Stúdió — fájlfeltöltés.
// A böngésző NEM kap service kulcsot: a szerver ad egy egyszer használatos,
// aláírt feltöltési linket a privát "content-media" tárhelyre, és a worker
// futáskor kap egy 24 órás aláírt letöltési linket ugyanarra a fájlra.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const MEDIA_BUCKET = "content-media";

/** Hova szánjuk a fájlt — ez dönti el, milyen worker-feladat lesz belőle. */
export const MEDIA_SLOTS = [
  { value: "linkedin_profile_photo", label: "LinkedIn profilkép" },
  { value: "linkedin_post_media", label: "LinkedIn poszt melléklete" },
  { value: "reddit_post_media", label: "Reddit poszt képe" },
  { value: "pinterest_pin", label: "Pinterest pin (kép/videó)" },
  { value: "tiktok_video", label: "TikTok videó" },
  { value: "generic_file", label: "Egyéb fájl (csak tárolás)" },
] as const;

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "fajl";
}

type Ctx = { supabase: { from: (t: "profiles") => never }; userId: string };

async function tenantOf(context: Ctx) {
  const { data } = await (context.supabase as never as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (a: string, b: string) => {
          maybeSingle: () => Promise<{ data: { tenant_id: string } | null }>;
        };
      };
    };
  })
    .from("profiles")
    .select("tenant_id")
    .eq("id", context.userId)
    .maybeSingle();
  if (!data?.tenant_id) throw new Error("tenant_id hiányzik a profilodhoz.");
  return data.tenant_id;
}


/** Aláírt feltöltési link kérése — a böngésző erre tölti fel a fájlt. */
export const createMediaUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { file_name: string }) => d)
  .handler(async ({ data, context }) => {
    const tenantId = await tenantOf(context as never);
    const path = `${tenantId}/${crypto.randomUUID()}-${safeName(data.file_name)}`;
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
    const tenantId = await tenantOf(context as never);
    if (!data.path.startsWith(`${tenantId}/`)) throw new Error("Nincs jogosultság ehhez a fájlhoz.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(data.path, data.expires_in ?? 3600);
    if (error || !signed) throw new Error(error?.message ?? "Nem sikerült linket készíteni.");
    return { url: signed.signedUrl };
  });
