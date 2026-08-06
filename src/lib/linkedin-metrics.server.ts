// LinkedIn metrika-pillanatképek elmentése és Telegram-összefoglaló.
//
// A worker `metrics_snapshot` futása visszaad egy poszt-listát; itt elmentjük
// a linkedin_post_metrics táblába, és összevetjük az előző méréssel, hogy
// lássuk, MENNYIT MOZDULT a poszt az utolsó ellenőrzés óta.

import type { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { sendTelegram } from "@/lib/reddit-post-patrol.server";

export type LinkedInSnapshotPost = {
  post_url: string | null;
  impressions: number | null;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function delta(now: number, before: number | null): string {
  if (before == null) return "";
  const d = now - before;
  return d > 0 ? ` (+${d})` : "";
}

export async function saveLinkedInMetrics(args: {
  tenantId: string;
  workflowId: string;
  posts: LinkedInSnapshotPost[];
}): Promise<{ saved: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as ReturnType<typeof createClient<Database>>;

  const posts = args.posts.filter((p) => p && (p.post_url || p.impressions != null));
  if (!posts.length) return { saved: 0 };

  // Előző mérés a különbségekhez
  const previous = new Map<string, LinkedInSnapshotPost>();
  const { data: prevRows } = await db
    .from("linkedin_post_metrics")
    .select("post_url, impressions, reactions, comments, reposts, captured_at")
    .eq("tenant_id", args.tenantId)
    .order("captured_at", { ascending: false })
    .limit(60);
  for (const r of prevRows ?? []) {
    if (r.post_url && !previous.has(r.post_url)) previous.set(r.post_url, r);
  }

  await db.from("linkedin_post_metrics").insert(
    posts.map((p) => ({
      tenant_id: args.tenantId,
      workflow_id: args.workflowId,
      post_url: p.post_url,
      impressions: p.impressions,
      reactions: p.reactions,
      comments: p.comments,
      reposts: p.reposts,
    })),
  );

  const lines = posts.slice(0, 5).map((p, i) => {
    const prev = p.post_url ? previous.get(p.post_url) : undefined;
    const imp = num(p.impressions);
    const rea = num(p.reactions);
    const com = num(p.comments);
    return [
      `${i + 1}. 👁 ${imp}${delta(imp, prev?.impressions ?? null)}`,
      `👍 ${rea}${delta(rea, prev?.reactions ?? null)}`,
      `💬 ${com}${delta(com, prev?.comments ?? null)}`,
    ].join(" · ");
  });

  const newComments = posts.reduce((sum, p) => {
    const prev = p.post_url ? previous.get(p.post_url) : undefined;
    return sum + Math.max(0, num(p.comments) - num(prev?.comments));
  }, 0);

  await sendTelegram(
    [
      `🔵 LINKEDIN · poszt-metrikák`,
      ``,
      ...lines,
      ``,
      newComments > 0
        ? `💬 ${newComments} ÚJ hozzászólás érkezett — érdemes ránézni és válaszolni.`
        : `Új hozzászólás nincs.`,
    ].join("\n"),
    {
      topic: "linkedin_metrics",
      platform: "linkedin",
      ref_table: "linkedin_post_metrics",
      ref_id: args.workflowId,
      label: "LinkedIn metrikák",
      payload: { post_count: posts.length, new_comments: newComments },
    },
  );

  return { saved: posts.length };
}
