// AI-patch csomag generátor — kliens-safe.
// A UI-ban a "Copy AI patch" gomb erre hívja. Kimenet: egyetlen Markdown blokk,
// amit a kylo.study Lovable chatjébe bemásolva egy prompttal végigmehet a listán.

export type PatchIssue = {
  id: string;
  severity: "critical" | "major" | "minor" | "info";
  category: string;
  page_url: string;
  language: string | null;
  skin: string | null;
  expected_language: string | null;
  detected_language: string | null;
  problematic_text: string | null;
  selector: string | null;
  ai_diagnosis: string | null;
  ai_suggested_fix: string | null;
  screenshot_signed_url?: string | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  translation_missing: "Fordítás hiányzik",
  translation_wrong: "Rossz fordítás",
  contrast: "Kontraszt / láthatóság",
  missing_back_button: "Hiányzó vissza gomb",
  broken_layout: "Törött layout",
  clipped_text: "Levágott szöveg",
  navigation_dead_end: "Navigációs zsákutca",
  console_error: "Konzol hiba",
  other: "Egyéb",
};

export function buildPatchPackage(opts: {
  runStartedAt: string;
  baseUrl: string;
  issues: PatchIssue[];
}): string {
  const { runStartedAt, baseUrl, issues } = opts;
  const date = new Date(runStartedAt).toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`# Kylo.study QA javítás — ${date} futás`);
  lines.push(`Base URL: ${baseUrl}`);
  lines.push(`Összes hiba a csomagban: **${issues.length}**`);
  lines.push("");
  lines.push(
    "**Instrukció az AI-nak (Lovable chat):** Az alábbi listán menj végig egyesével. " +
      "Minden hibához: (1) keresd meg az érintett komponenst a szelektor + oldal URL alapján, " +
      "(2) ha fordítási hiba: adj hozzá kulcsot a locale fájlhoz és cseréld a hardcode-ot t()-re, " +
      "(3) ha vizuális hiba: javítsd a Tailwind osztályt vagy a téma tokent, " +
      "(4) ha navigációs hiba: add hozzá a hiányzó vissza gombot / linket. " +
      "Végén foglald össze mit módosítottál.",
  );
  lines.push("");
  lines.push("---");

  issues.forEach((iss, idx) => {
    lines.push("");
    lines.push(
      `## [HIBA #${idx + 1} — ${iss.severity}] ${CATEGORY_LABEL[iss.category] ?? iss.category}`,
    );
    lines.push(`- **Oldal**: \`${iss.page_url}\``);
    if (iss.language) lines.push(`- **Nyelvi beállítás**: ${iss.language}`);
    if (iss.skin) lines.push(`- **Skin**: ${iss.skin}`);
    if (iss.selector) lines.push(`- **Szelektor**: \`${iss.selector}\``);
    if (iss.problematic_text)
      lines.push(`- **Problémás szöveg**: "${iss.problematic_text}"`);
    if (iss.expected_language && iss.detected_language)
      lines.push(
        `- **Nyelv-eltérés**: elvárt \`${iss.expected_language}\`, észlelt \`${iss.detected_language}\``,
      );
    if (iss.ai_diagnosis)
      lines.push(`- **Diagnózis**: ${iss.ai_diagnosis}`);
    if (iss.ai_suggested_fix)
      lines.push(`- **Javasolt javítás**: ${iss.ai_suggested_fix}`);
    if (iss.screenshot_signed_url)
      lines.push(`- **Screenshot**: ${iss.screenshot_signed_url}`);
    lines.push("");
    lines.push("---");
  });

  return lines.join("\n");
}
