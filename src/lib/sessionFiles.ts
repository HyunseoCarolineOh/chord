import { supabase } from "./supabase";
import type { SessionFile } from "../types";

export async function listSessionFiles(sessionId: string): Promise<SessionFile[]> {
  const { data, error } = await supabase
    .from("chord_session_files")
    .select("*")
    .eq("session_id", sessionId)
    .order("added_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SessionFile[];
}

export async function addSessionFile(
  sessionId: string,
  path: string,
  role: "primary" | "reference" = "primary",
): Promise<SessionFile | null> {
  const { data, error } = await supabase
    .from("chord_session_files")
    .upsert({ session_id: sessionId, path, role }, { onConflict: "session_id,path" })
    .select()
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as SessionFile | null;
}

export async function removeSessionFile(sessionId: string, path: string): Promise<void> {
  const { error } = await supabase
    .from("chord_session_files")
    .delete()
    .eq("session_id", sessionId)
    .eq("path", path);
  if (error) throw error;
}
