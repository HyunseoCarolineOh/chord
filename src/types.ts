export type Workspace = {
  id: string;
  name: string;
  root_path: string;
  vscode_workspace_path: string | null;
  default_branch: string | null;
  remote_name: string | null;
  created_at: string;
};

export type McpServerConfig = {
  name: string;
  type: "stdio" | "sse" | "http";
  command?: string;        // stdio
  args?: string[];          // stdio
  env?: Record<string, string>;
  url?: string;             // sse | http
  headers?: Record<string, string>;
};

export type Channel = {
  id: string;
  workspace_id: string;
  name: string;
  cwd: string | null;
  allowed_tools: string[];
  agent_ids: string[];
  active_session_id: string | null;
  archived: boolean;
  mcp_servers: McpServerConfig[];
  created_at: string;
};

export type Session = {
  id: string;
  channel_id: string;
  name: string;
  status: "active" | "closed";
  archived: boolean;
  started_at: string;
  ended_at: string | null;
};

export type MessageRole = "user" | "agent" | "system";

export type Message = {
  id: string;
  session_id: string;
  thread_id: string | null;
  role: MessageRole;
  agent_name: string | null;
  content: string;
  tool_calls: unknown[];
  source: "user" | "cron" | "webhook";
  created_at: string;
  deleted_at: string | null;
  edited_at: string | null;
};

export type SessionFile = {
  id: string;
  session_id: string;
  path: string;
  role: "primary" | "reference";
  added_at: string;
};

export type Thread = {
  id: string;
  session_id: string;
  parent_message_id: string | null;
  title: string | null;
  is_pinned: boolean;
  name: string | null;
  created_at: string;
};

export type ScheduledJob = {
  id: string;
  channel_id: string;
  thread_id: string | null;
  name: string;
  agent_name: string;
  prompt_template: string;
  cron_spec: string;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
};

export type Diagnostic = {
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  line: number;
  source?: string;
};

export type OpenFile = {
  id: string;
  workspace_id: string;
  path: string;
  source: "vscode" | "chord";
  is_active: boolean;
  language: string | null;
  cursor_line: number | null;
  selection_start_line: number | null;
  selection_start_col: number | null;
  selection_end_line: number | null;
  selection_end_col: number | null;
  diagnostics: Diagnostic[];
  last_synced_at: string;
};

export type AgentDef = {
  name: string;
  description?: string;
  model?: string;
  tools?: string[];
  systemPrompt: string;
};
