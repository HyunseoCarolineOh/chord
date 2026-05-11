// Supabase realtime — 멀티 디바이스/창 동기화.
// chord_messages · chord_open_files · chord_channels · chord_sessions 변경을 push.
import { supabase } from "./supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

type Handlers = {
  onMessageInsert?: (row: any) => void;
  onMessageUpdate?: (row: any) => void;
  onChannelChange?: () => void;
  onSessionChange?: () => void;
  onOpenFileChange?: () => void;
};

export function subscribeWorkspace(workspaceId: string, h: Handlers): RealtimeChannel {
  const ch = supabase
    .channel(`chord-ws-${workspaceId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "chord_messages" },
      (p) => h.onMessageInsert?.(p.new),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "chord_messages" },
      (p) => h.onMessageUpdate?.(p.new),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "chord_channels", filter: `workspace_id=eq.${workspaceId}` },
      () => h.onChannelChange?.(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "chord_sessions" },
      () => h.onSessionChange?.(),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "chord_open_files", filter: `workspace_id=eq.${workspaceId}` },
      () => h.onOpenFileChange?.(),
    )
    .subscribe();

  return ch;
}

export async function unsubscribe(ch: RealtimeChannel): Promise<void> {
  await supabase.removeChannel(ch);
}

export async function listOpenFiles(workspaceId: string) {
  const { data, error } = await supabase
    .from("chord_open_files")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("last_synced_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
