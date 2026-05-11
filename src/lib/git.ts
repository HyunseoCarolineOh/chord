// Tauri git commands wrapper
import { invoke } from "@tauri-apps/api/core";

export type StatusEntry = {
  path: string;
  status: "modified" | "added" | "deleted" | "untracked" | "renamed" | "conflicted";
  staged: boolean;
};

export type GitStatus = {
  branch: string;
  ahead: number;
  behind: number;
  entries: StatusEntry[];
};

export type BranchInfo = {
  name: string;
  is_current: boolean;
  upstream: string | null;
};

export type LogEntry = {
  sha: string;
  short_sha: string;
  author: string;
  email: string;
  message: string;
  time: number;
};

export async function gitStatus(root: string): Promise<GitStatus> {
  return invoke<GitStatus>("git_status", { root });
}

export async function gitDiff(root: string, relPath: string): Promise<string> {
  return invoke<string>("git_diff", { root, relPath });
}

export async function gitBranches(root: string): Promise<BranchInfo[]> {
  return invoke<BranchInfo[]>("git_branches", { root });
}

export async function gitCheckout(root: string, branch: string): Promise<void> {
  return invoke<void>("git_checkout", { root, branch });
}

export async function gitLog(root: string, limit?: number): Promise<LogEntry[]> {
  return invoke<LogEntry[]>("git_log", { root, limit });
}

/** stage → commit → push 한 번에. paths 비우면 모든 변경 stage. message 비우면 자동. */
export async function gitSync(root: string, paths: string[], message: string): Promise<string> {
  return invoke<string>("git_sync", { root, paths, message });
}

export type StashEntry = { index: number; message: string; oid: string };
export type RebaseStatus = { in_progress: boolean; current: number | null; total: number; conflicted_paths: string[] };
export type ConflictFile = { path: string; ours: string | null; theirs: string | null; ancestor: string | null };

export async function gitStashSave(root: string, message: string): Promise<string> {
  return invoke<string>("git_stash_save", { root, message });
}
export async function gitStashList(root: string): Promise<StashEntry[]> {
  return invoke<StashEntry[]>("git_stash_list", { root });
}
export async function gitStashPop(root: string, index: number): Promise<void> {
  return invoke<void>("git_stash_pop", { root, index });
}
export async function gitStashDrop(root: string, index: number): Promise<void> {
  return invoke<void>("git_stash_drop", { root, index });
}
export async function gitRebaseStatus(root: string): Promise<RebaseStatus> {
  return invoke<RebaseStatus>("git_rebase_status", { root });
}
export async function gitRebaseStart(root: string, onto: string): Promise<RebaseStatus> {
  return invoke<RebaseStatus>("git_rebase_start", { root, onto });
}
export async function gitRebaseContinue(root: string): Promise<RebaseStatus> {
  return invoke<RebaseStatus>("git_rebase_continue", { root });
}
export async function gitRebaseAbort(root: string): Promise<void> {
  return invoke<void>("git_rebase_abort", { root });
}
export async function gitConflicts(root: string): Promise<ConflictFile[]> {
  return invoke<ConflictFile[]>("git_conflicts", { root });
}
