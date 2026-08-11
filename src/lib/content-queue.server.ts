// Közös logika: egy mentett szövegből (content_drafts) futtatható worker-feladat
// készítése. Ugyanezt használja a kézi „Kiküldés” gomb és az időzített kiküldő cron.

type Sb = {
  from: (t: string) => any;
};

export async function queueDraftToWorker(
  sb: Sb,
  draftId: string,
  opts: { submit?: boolean; dry_run?: boolean } = {},
) {
  const { data: draft, error } = await sb
    .from("content_drafts")
    .select("*")
    .eq("id", draftId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!draft) throw new Error("A szöveg nem található.");
  if (!draft.target_workflow_id) throw new Error("Válassz cél-workflow-t!");

  const { data: wf } = await sb
    .from("workflows")
    .select("id, tenant_id, spec, platform")
    .eq("id", draft.target_workflow_id)
    .maybeSingle();
  if (!wf) throw new Error("A cél-workflow nem található.");

  const { data: cred } = await sb
    .from("workflow_credentials")
    .select("proxy_id")
    .eq("workflow_id", wf.id)
    .maybeSingle();

  const spec = (wf.spec ?? {}) as Record<string, unknown>;
  const platform = (wf.platform ?? "reddit").toLowerCase();
  const slot = (draft.media_slot as string | null) ?? null;
  const mediaPath = (draft.media_path as string | null) ?? null;

  let media:
    | { kind: "url"; value: string; name: string | null; mime: string | null }
    | null = null;
  if (mediaPath) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("content-media")
      .createSignedUrl(mediaPath, 60 * 60 * 24);
    if (sErr || !signed) throw new Error(sErr?.message ?? "Nem sikerült a fájl linkje.");
    media = {
      kind: "url",
      value: signed.signedUrl,
      name: (draft.media_name as string | null) ?? null,
      mime: (draft.media_mime as string | null) ?? null,
    };
  }

  const slotPlan: Record<string, { task: string; platform: string; url: string }> = {
    linkedin_profile_photo: {
      task: "linkedin_profile_photo",
      platform: "linkedin",
      url: "https://www.linkedin.com/in/me/",
    },
    linkedin_post_media: {
      task: "linkedin_post",
      platform: "linkedin",
      url: "https://www.linkedin.com/feed/",
    },
    reddit_post_media: {
      task: "reddit_post",
      platform: "reddit",
      url: "https://www.reddit.com/",
    },
    pinterest_pin: {
      task: "upload_pin",
      platform: "pinterest",
      url: "https://www.pinterest.com/",
    },
    tiktok_video: {
      task: "upload_video",
      platform: "tiktok",
      url: "https://www.tiktok.com/",
    },
  };
  const planned = media && slot ? slotPlan[slot] : undefined;
  if (media && slot === "generic_file") {
    throw new Error("Az „Egyéb fájl” csak tárolás — válassz konkrét célt a kiküldéshez.");
  }

  const isLinkedIn = planned
    ? planned.platform === "linkedin"
    : platform === "linkedin" || draft.kind === "linkedin_post";

  const taskType =
    planned?.task ??
    (isLinkedIn
      ? "linkedin_post"
      : draft.kind === "reddit_comment"
        ? "reddit_comment"
        : "reddit_post");

  const effPlatform = planned?.platform ?? (isLinkedIn ? "linkedin" : platform);
  const startUrl =
    planned?.url ?? (isLinkedIn ? "https://www.linkedin.com/feed/" : "https://www.reddit.com/");

  const specSnapshot = {
    ...spec,
    platform: effPlatform,
    start_url: startUrl,
    brain_task: {
      platform: effPlatform,
      task_type: taskType,
      draft_id: draft.id,
      title: draft.title,
      body: draft.body,
      caption: draft.body || null,
      description: draft.body || null,
      media,
      media_slot: slot,
      subreddit: isLinkedIn ? null : (draft.target_ref ?? null),
      target_ref: draft.target_ref ?? null,
      board_name: effPlatform === "pinterest" ? (draft.target_ref ?? null) : null,
      submit: opts.submit !== false,
      dry_run: !!opts.dry_run,
    },
  };

  const { data: run, error: rErr } = await sb
    .from("brain_workflow_runs")
    .insert({
      workflow_id: wf.id,
      tenant_id: wf.tenant_id,
      runner: "docker",
      status: "queued",
      module: "brain",
      proxy_id: cred?.proxy_id ?? null,
      spec_snapshot: specSnapshot,
    })
    .select("id")
    .single();
  if (rErr || !run) throw new Error(rErr?.message ?? "Nem sikerült sorba állítani.");

  await sb
    .from("content_drafts")
    .update({
      status: opts.dry_run ? "dry_run" : "queued",
      last_run_id: run.id,
      submitted_at: new Date().toISOString(),
      scheduled_for: null,
    })
    .eq("id", draft.id);

  return { run_id: run.id as string };
}
