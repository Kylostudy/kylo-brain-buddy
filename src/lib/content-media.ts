// Tartalom Stúdió — fájlfeltöltés közös konstansai (kliens és szerver is használja).

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

export function safeMediaName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "fajl";
}
