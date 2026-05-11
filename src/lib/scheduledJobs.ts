import { supabase } from "./supabase";
import type { ScheduledJob, Thread } from "../types";
import { parseNextRun } from "./cron";

export async function listJobsForWorkspace(workspaceId: string): Promise<ScheduledJob[]> {
  // 두 단계로 분해 (nested filter가 supabase-js에서 안정적이지 않아서)
  const { data: chs, error: chErr } = await supabase
    .from("chord_channels")
    .select("id")
    .eq("workspace_id", workspaceId);
  if (chErr) throw chErr;
  const ids = (chs ?? []).map((c: { id: string }) => c.id);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("chord_scheduled_jobs")
    .select("*")
    .in("channel_id", ids)
    .eq("enabled", true);
  if (error) throw error;
  return (data ?? []) as ScheduledJob[];
}

export async function markJobRan(job: ScheduledJob): Promise<void> {
  const now = new Date();
  const next = parseNextRun(job.cron_spec, now);
  await supabase
    .from("chord_scheduled_jobs")
    .update({
      last_run_at: now.toISOString(),
      next_run_at: next ? next.toISOString() : null,
    })
    .eq("id", job.id);
}

export async function setJobNextRun(jobId: string, next: Date | null): Promise<void> {
  await supabase
    .from("chord_scheduled_jobs")
    .update({ next_run_at: next ? next.toISOString() : null })
    .eq("id", jobId);
}

export async function getThread(threadId: string): Promise<Thread | null> {
  const { data, error } = await supabase
    .from("chord_threads")
    .select("*")
    .eq("id", threadId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Thread | null;
}

export async function listPinnedThreads(workspaceId: string): Promise<
  (Thread & { channel_name: string; channel_id: string })[]
> {
  // 3단계 query: channels → sessions → pinned threads
  const { data: chs, error: chErr } = await supabase
    .from("chord_channels")
    .select("id, name")
    .eq("workspace_id", workspaceId);
  if (chErr) throw chErr;
  if (!chs || chs.length === 0) return [];
  const chMap = new Map<string, string>(
    (chs as { id: string; name: string }[]).map((c) => [c.id, c.name]),
  );
  const chIds = (chs as { id: string }[]).map((c) => c.id);

  const { data: sess, error: sErr } = await supabase
    .from("chord_sessions")
    .select("id, channel_id")
    .in("channel_id", chIds);
  if (sErr) throw sErr;
  if (!sess || sess.length === 0) return [];
  const sMap = new Map<string, string>(
    (sess as { id: string; channel_id: string }[]).map((s) => [s.id, s.channel_id]),
  );
  const sIds = (sess as { id: string }[]).map((s) => s.id);

  const { data: ths, error: tErr } = await supabase
    .from("chord_threads")
    .select("*")
    .eq("is_pinned", true)
    .in("session_id", sIds);
  if (tErr) throw tErr;

  return ((ths ?? []) as Thread[]).map((t) => {
    const channel_id = sMap.get(t.session_id) ?? "";
    const channel_name = chMap.get(channel_id) ?? "";
    return { ...t, channel_id, channel_name };
  });
}
