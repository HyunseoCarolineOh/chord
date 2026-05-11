import { supabase } from "./supabase";
import type { Workspace, Channel, Session, Message } from "../types";

export async function listWorkspaces(): Promise<Workspace[]> {
  const { data, error } = await supabase
    .from("chord_workspaces")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Workspace[];
}

export async function listChannels(workspaceId: string): Promise<Channel[]> {
  const { data, error } = await supabase
    .from("chord_channels")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Channel[];
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const { data, error } = await supabase
    .from("chord_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Session | null;
}

export async function listMessages(sessionId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("chord_messages")
    .select("*")
    .eq("session_id", sessionId)
    .is("thread_id", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Message[];
}

export async function insertUserMessage(sessionId: string, content: string): Promise<Message> {
  const { data, error } = await supabase
    .from("chord_messages")
    .insert({
      session_id: sessionId,
      role: "user",
      content,
    })
    .select()
    .single();
  if (error) throw error;
  return data as Message;
}
