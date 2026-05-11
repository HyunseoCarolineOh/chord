import { useEffect, useMemo, useState, useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { Sidebar } from "./components/Sidebar";
import { MessageList } from "./components/MessageList";
import { Composer } from "./components/Composer";
import { Modal } from "./components/Modal";
import { Editor } from "./components/Editor";
import { SidePanel } from "./components/SidePanel";
import { GitPanel } from "./components/GitPanel";
import { RightPanel } from "./components/RightPanel";
import { ThreadView } from "./components/ThreadView";
import { SearchModal } from "./components/SearchModal";
import { AgentAvatar } from "./components/AgentAvatar";
import { subscribeWorkspace, unsubscribe } from "./lib/realtime";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { listWorkspaces, listChannels, listMessages, getSession } from "./lib/db";
import { listSessionFiles } from "./lib/sessionFiles";
import { createThread, listThreadSummaries, type ThreadSummary } from "./lib/threads";
import {
  insertMessage,
  updateMessage,
  softDeleteMessage,
  editMessageContent,
} from "./lib/messages";
import { route } from "./lib/router";
import { runSlash } from "./lib/slash";
import {
  buildDebatePrompt,
  recordSpeech,
  endDebate,
  getDebate,
  hasConclusionMarker,
  parseNextSpeaker,
  totalSpeeches,
  MAX_TOTAL_SPEECHES,
  CONCLUSION_MARKER,
} from "./lib/debate";
import { supabase } from "./lib/supabase";
import { runQuery } from "./lib/sidecar";
import { loadAgent, resolveAgentPath } from "./lib/agentLoader";
import { fsHomeDir } from "./lib/fs";
import {
  listJobsForWorkspace,
  markJobRan,
  listPinnedThreads,
  getThread,
} from "./lib/scheduledJobs";
import { renderPromptTemplate, todayISO } from "./lib/cron";
import type { PinnedThread } from "./components/Sidebar";
import type { ScheduledJob } from "./types";
import type { Workspace, Channel, Session, Message, Thread } from "./types";
import "./App.css";

function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);

  // 모달·패널 상태
  const [gitFullOpen, setGitFullOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // 사이드 패널: 탭으로 스레드 / 파일을 동시에 열어둠 (브라우저 스타일)
  type PanelTab =
    | { id: string; kind: "thread"; thread: Thread; parent: Message | null; title: string }
    | { id: string; kind: "file"; path: string | null; title: string; line?: number; col?: number };
  const [panelTabs, setPanelTabs] = useState<PanelTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem("chord.panelWidth") : null;
    const n = saved ? Number(saved) : NaN;
    return Number.isFinite(n) ? Math.max(280, Math.min(1200, n)) : 440;
  });

  useEffect(() => {
    try {
      localStorage.setItem("chord.panelWidth", String(panelWidth));
    } catch {}
  }, [panelWidth]);

  const openThreadTab = useCallback((thread: Thread, parent: Message | null) => {
    const id = `thread-${thread.id}`;
    setPanelTabs((prev) =>
      prev.some((t) => t.id === id)
        ? prev
        : [
            ...prev,
            {
              id,
              kind: "thread",
              thread,
              parent,
              title: thread.name ?? thread.title ?? "(thread)",
            },
          ],
    );
    setActiveTabId(id);
  }, []);

  const openFileTab = useCallback((path: string | null, line?: number, col?: number) => {
    const id = path ? `file:${path}` : `file:blank:${Date.now()}`;
    const baseTitle = path ? (path.split(/[\\/]/).pop() ?? path) : "(empty)";
    const title = path && line ? `${baseTitle}:${line}` : baseTitle;
    setPanelTabs((prev) => {
      const existing = prev.find((t) => t.id === id);
      if (existing) {
        // 같은 파일 탭에 다른 line/col로 다시 열면 갱신 (Editor가 effect로 재점프)
        if (existing.kind === "file" && (existing.line !== line || existing.col !== col || existing.title !== title)) {
          return prev.map((t) =>
            t.id === id && t.kind === "file" ? { ...t, line, col, title } : t,
          );
        }
        return prev;
      }
      return [...prev, { id, kind: "file", path, title, line, col }];
    });
    setActiveTabId(id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setPanelTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx < 0) return prev;
      const next = prev.filter((t) => t.id !== id);
      setActiveTabId((curr) => {
        if (curr !== id) return curr;
        if (next.length === 0) return null;
        return next[Math.min(idx, next.length - 1)].id;
      });
      return next;
    });
  }, []);

  const onResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = panelWidth;
      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const max = Math.max(360, Math.floor(window.innerWidth * 0.7));
        const next = Math.max(280, Math.min(max, startW - dx));
        setPanelWidth(next);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [panelWidth],
  );

  // pinned threads + scheduled jobs (사이드바)
  const [pinnedThreads, setPinnedThreads] = useState<PinnedThread[]>([]);
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledJob[]>([]);

  // active session thread summaries — 채널 본문 메시지에 "N개의 댓글" chip 표시용
  const [threadSummaries, setThreadSummaries] = useState<ThreadSummary[]>([]);

  // workspaces
  useEffect(() => {
    void (async () => {
      try {
        const ws = await listWorkspaces();
        setWorkspaces(ws);
        if (ws[0]) setSelectedWorkspaceId(ws[0].id);
      } catch (e) {
        setError(toMsg(e));
      }
    })();
  }, []);

  // channels
  const reloadChannels = useCallback(async () => {
    if (!selectedWorkspaceId) return;
    try {
      const ch = await listChannels(selectedWorkspaceId);
      setChannels(ch);
      if (!selectedChannelId && ch[0]) setSelectedChannelId(ch[0].id);
    } catch (e) {
      setError(toMsg(e));
    }
  }, [selectedWorkspaceId, selectedChannelId]);

  useEffect(() => { void reloadChannels(); }, [reloadChannels]);

  // pinned threads + scheduled jobs 로드 (workspace 변경마다)
  const reloadPinnedAndJobs = useCallback(async () => {
    if (!selectedWorkspaceId) {
      setPinnedThreads([]);
      setScheduledJobs([]);
      return;
    }
    try {
      const [pt, jobs] = await Promise.all([
        listPinnedThreads(selectedWorkspaceId),
        listJobsForWorkspace(selectedWorkspaceId),
      ]);
      setPinnedThreads(pt);
      setScheduledJobs(jobs);
    } catch (e) {
      console.error("pinned/jobs reload failed", e);
    }
  }, [selectedWorkspaceId]);

  useEffect(() => { void reloadPinnedAndJobs(); }, [reloadPinnedAndJobs]);

  // active session + messages
  const loadSessionAndMessages = useCallback(async (channel: Channel) => {
    try {
      const session = channel.active_session_id ? await getSession(channel.active_session_id) : null;
      setActiveSession(session);
      const msgs = session ? await listMessages(session.id) : [];
      setMessages(msgs);
      // thread summaries (채널 본문 chip)
      const summaries = session ? await listThreadSummaries(session.id) : [];
      setThreadSummaries(summaries);
    } catch (e) {
      setError(toMsg(e));
    }
  }, []);

  // 활성 세션의 thread summaries만 reload (realtime 호출용)
  const reloadThreadSummaries = useCallback(async () => {
    if (!activeSession) return;
    try {
      setThreadSummaries(await listThreadSummaries(activeSession.id));
    } catch {
      /* swallow */
    }
  }, [activeSession]);

  // parent_message_id → summary 매핑 (MessageList chip 렌더용)
  const threadByParent = useMemo(() => {
    const m = new Map<string, ThreadSummary>();
    for (const s of threadSummaries) {
      if (s.parent_message_id) m.set(s.parent_message_id, s);
    }
    return m;
  }, [threadSummaries]);

  useEffect(() => {
    if (!selectedChannelId) {
      setActiveSession(null);
      setMessages([]);
      return;
    }
    const channel = channels.find((c) => c.id === selectedChannelId);
    if (!channel) return;
    void loadSessionAndMessages(channel);
  }, [selectedChannelId, channels, loadSessionAndMessages]);

  // 에이전트 호출 (agent.md 로드 + session_files 메타 + cwd + tools)
  const callAgent = useCallback(
    async (agentName: string, channel: Channel, workspaceRoot: string, sessionId: string, prompt: string) => {
      let placeholder: Message;
      try {
        placeholder = await insertMessage({ sessionId, role: "agent", agentName, content: "" });
      } catch (e) {
        setError(toMsg(e));
        return;
      }
      setMessages((prev) => [...prev, placeholder]);

      const toolCalls: unknown[] = [];

      // 컨텍스트 조립
      const agentDef = await loadAgent(workspaceRoot, agentName);
      const sessionFiles = await listSessionFiles(sessionId).catch(() => []);
      const { listOpenFiles } = await import("./lib/realtime");
      const openFiles = await listOpenFiles(channel.workspace_id).catch(() => []);

      const sessionFilesBlock =
        sessionFiles.length > 0
          ? "\n\n## 세션 첨부 파일\n" +
            sessionFiles
              .map((f) => `- ${f.path}${f.role === "primary" ? " (primary)" : ""}`)
              .join("\n")
          : "";

      const openFilesBlock =
        openFiles.length > 0
          ? "\n\n## 사용자가 지금 보고 있는 파일 (VS Code · chord)\n" +
            openFiles
              .slice(0, 20)
              .map((f: any) => {
                const tag = f.is_active ? " (active)" : "";
                const src = `[${f.source}]`;
                const cur = f.cursor_line ? ` line ${f.cursor_line}` : "";
                const diags =
                  Array.isArray(f.diagnostics) && f.diagnostics.length > 0
                    ? ` · ${f.diagnostics.filter((d: any) => d.severity === "error").length} err / ${f.diagnostics.filter((d: any) => d.severity === "warning").length} warn`
                    : "";
                return `- ${src} ${f.path}${cur}${tag}${diags}`;
              })
              .join("\n")
          : "";

      const filesBlock =
        sessionFilesBlock + openFilesBlock +
        (sessionFilesBlock || openFilesBlock
          ? "\n\n내용은 필요 시 Read 도구로 직접 읽을 것."
          : "");

      const allowedTools =
        agentDef.tools && agentDef.tools.length > 0
          ? agentDef.tools.filter((t) => channel.allowed_tools.length === 0 || channel.allowed_tools.includes(t))
          : channel.allowed_tools.length > 0
            ? channel.allowed_tools
            : undefined;

      const mcpServers =
        channel.mcp_servers && channel.mcp_servers.length > 0
          ? Object.fromEntries(
              channel.mcp_servers.map((s) => {
                const { name, ...rest } = s;
                return [name, rest];
              }),
            )
          : undefined;

      try {
        const final = await runQuery(
          {
            prompt,
            cwd: channel.cwd ?? workspaceRoot,
            allowedTools,
            model: agentDef.model,
            systemPrompt: agentDef.systemPrompt + filesBlock,
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
            mcpServers,
          },
          {
            onAssistantText: (delta) => {
              setMessages((prev) =>
                prev.map((m) => (m.id === placeholder.id ? { ...m, content: m.content + delta } : m)),
              );
            },
            onToolUse: (tu) => {
              toolCalls.push({ kind: "use", ...tu });
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === placeholder.id ? { ...m, tool_calls: [...(m.tool_calls ?? []), { kind: "use", ...tu }] } : m,
                ),
              );
            },
            onToolResult: (tr) => {
              toolCalls.push({ kind: "result", ...tr });
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === placeholder.id ? { ...m, tool_calls: [...(m.tool_calls ?? []), { kind: "result", ...tr }] } : m,
                ),
              );
            },
          },
        );
        await updateMessage(placeholder.id, { content: final.fullText, tool_calls: toolCalls });
      } catch (e) {
        const msg = toMsg(e);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === placeholder.id ? { ...m, content: m.content + `\n\n[error] ${msg}` } : m,
          ),
        );
      }
    },
    [],
  );

  // 스레드 안에서 에이전트 호출 (cron 자동 라우팅용). 메인 messages state는 갱신 안 함 — ThreadView가 자체 reload.
  // 반환값 fullText는 /debate 자동 체이닝에서 다음 발화자 파싱에 쓰임.
  const callAgentInThread = useCallback(
    async (agentName: string, channel: Channel, workspaceRoot: string, sessionId: string, threadId: string, prompt: string): Promise<{ fullText: string }> => {
      // INSERT 시 thread_id 같이 박아야 realtime filter `thread_id=eq.<id>` 매칭됨
      const { data: ph, error: insErr } = await supabase
        .from("chord_messages")
        .insert({
          session_id: sessionId,
          thread_id: threadId,
          role: "agent",
          agent_name: agentName,
          content: "",
        })
        .select()
        .single();
      if (insErr || !ph) {
        console.error("placeholder insert failed", insErr);
        return { fullText: "" };
      }
      const placeholder = ph as Message;

      const toolCalls: unknown[] = [];
      let fullText = "";
      const agentDef = await loadAgent(workspaceRoot, agentName);
      const sessionFiles = await listSessionFiles(sessionId).catch(() => []);

      const sessionFilesBlock =
        sessionFiles.length > 0
          ? "\n\n## 세션 첨부 파일\n" +
            sessionFiles.map((f) => `- ${f.path}${f.role === "primary" ? " (primary)" : ""}`).join("\n")
          : "";

      const allowedTools =
        agentDef.tools && agentDef.tools.length > 0
          ? agentDef.tools.filter((t) => channel.allowed_tools.length === 0 || channel.allowed_tools.includes(t))
          : channel.allowed_tools.length > 0
            ? channel.allowed_tools
            : undefined;

      const mcpServers =
        channel.mcp_servers && channel.mcp_servers.length > 0
          ? Object.fromEntries(channel.mcp_servers.map((s) => {
              const { name, ...rest } = s;
              return [name, rest];
            }))
          : undefined;

      let accumulated = "";
      try {
        const final = await runQuery(
          {
            prompt,
            cwd: channel.cwd ?? workspaceRoot,
            allowedTools,
            model: agentDef.model,
            systemPrompt: agentDef.systemPrompt + sessionFilesBlock,
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
            mcpServers,
          },
          {
            onAssistantText: (delta) => {
              accumulated += delta;
              void supabase.from("chord_messages").update({ content: accumulated }).eq("id", placeholder.id);
            },
            onToolUse: (tu) => { toolCalls.push({ kind: "use", ...tu }); },
            onToolResult: (tr) => { toolCalls.push({ kind: "result", ...tr }); },
          },
        );
        fullText = final.fullText;
        await updateMessage(placeholder.id, { content: final.fullText, tool_calls: toolCalls });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const errBody = accumulated + `\n\n[error] ${msg}`;
        fullText = errBody;
        await updateMessage(placeholder.id, {
          content: errBody,
          tool_calls: toolCalls,
        });
      }
      return { fullText };
    },
    [],
  );

  // /debate 자동 체이닝: 한 발화자 호출 → 응답 파싱 → 종료 조건 체크 → 다음 발화자 재귀.
  // 일시정지(다음 멘션 없음)는 그냥 return — 사용자가 thread에 새 메시지 보내면 ThreadView가 재개.
  const dispatchDebateSpeaker = useCallback(
    async (
      speakerKey: string,
      threadId: string,
      participants: string[],
      channel: Channel,
      workspaceRoot: string,
      sessionId: string,
    ): Promise<void> => {
      const debate = await getDebate(threadId);
      if (!debate || debate.ended) return;
      if (totalSpeeches(debate) >= MAX_TOTAL_SPEECHES) {
        await endDebate(threadId, "max_total_speeches");
        await supabase.from("chord_messages").insert({
          session_id: sessionId,
          thread_id: threadId,
          role: "system",
          content: `누적 발화 ${MAX_TOTAL_SPEECHES}회 도달 — 안전망으로 토론을 종료합니다.`,
        });
        return;
      }

      const others = participants.filter((p) => p !== speakerKey);
      const prompt = await buildDebatePrompt({
        threadId,
        topic: debate.topic,
        speakerKey,
        available: others,
      });

      const { fullText } = await callAgentInThread(
        speakerKey,
        channel,
        workspaceRoot,
        sessionId,
        threadId,
        prompt,
      );

      await recordSpeech(threadId, speakerKey);

      if (hasConclusionMarker(fullText, CONCLUSION_MARKER)) {
        await endDebate(threadId, "concluded");
        await supabase.from("chord_messages").insert({
          session_id: sessionId,
          thread_id: threadId,
          role: "system",
          content: `@${speakerKey}가 결론을 제시해 토론을 마칩니다.`,
        });
        return;
      }

      // 다시 fetch (UPDATE 사이 사용자가 /debate end 쳤을 수 있음)
      const fresh = await getDebate(threadId);
      if (!fresh || fresh.ended) return;
      if (totalSpeeches(fresh) >= MAX_TOTAL_SPEECHES) {
        await endDebate(threadId, "max_total_speeches");
        await supabase.from("chord_messages").insert({
          session_id: sessionId,
          thread_id: threadId,
          role: "system",
          content: `누적 발화 ${MAX_TOTAL_SPEECHES}회 도달 — 안전망으로 토론을 종료합니다.`,
        });
        return;
      }

      const nextKey = parseNextSpeaker(fullText, others);
      if (!nextKey) return; // 일시정지
      if (nextKey === speakerKey) return; // 자기 자신 멘션 무시
      await dispatchDebateSpeaker(nextKey, threadId, participants, channel, workspaceRoot, sessionId);
    },
    [callAgentInThread],
  );

  const onSend = useCallback(
    async (text: string) => {
      setError(null);
      const channel = channels.find((c) => c.id === selectedChannelId);
      const workspace = workspaces.find((w) => w.id === selectedWorkspaceId);
      if (!channel || !workspace) {
        setError("채널 또는 워크스페이스가 선택되지 않았습니다.");
        return;
      }

      const r = route(text);

      if (r.kind === "slash") {
        const result = await runSlash(channel, workspace, r.command, r.args, activeSession);

        if (!result.ok) {
          setError(result.message);
          return;
        }

        if (result.workspaceChanged) {
          await reloadChannels();
        }

        if (result.channelChanged) {
          const fresh = await refetchChannel(channel.id);
          if (fresh) {
            setChannels((prev) => prev.map((c) => (c.id === fresh.id ? fresh : c)));
            await loadSessionAndMessages(fresh);
            if (fresh.active_session_id) {
              await insertMessage({ sessionId: fresh.active_session_id, role: "system", content: result.message });
              setMessages(await listMessages(fresh.active_session_id));
            }
          }
        } else if (channel.active_session_id) {
          await insertMessage({ sessionId: channel.active_session_id, role: "system", content: result.message });
          setMessages(await listMessages(channel.active_session_id));
        }

        // /debate 시작 — thread tab을 열고 첫 발화자 dispatch 시작
        if (result.debate?.kind === "start" && activeSession) {
          const d = result.debate;
          openThreadTab(d.thread, null);
          // 메인 채널에 thread chip이 즉시 보이도록 summaries 재로드
          void reloadThreadSummaries();
          // 첫 발화자 호출 (await — 체이닝 loop가 자체적으로 doneed)
          void dispatchDebateSpeaker(
            d.firstSpeaker,
            d.thread.id,
            d.participants,
            channel,
            workspace.root_path,
            activeSession.id,
          );
        }
        return;
      }

      if (!activeSession) {
        setError('active session이 없습니다 — "/session start <name>" 으로 먼저 세션을 여세요.');
        return;
      }

      const userMsg = await insertMessage({ sessionId: activeSession.id, role: "user", content: r.raw });
      setMessages((prev) => [...prev, userMsg]);

      // 채널 본문 메시지에 대한 AI 응답은 새 thread 안에서 진행.
      // 채널 본문엔 user 메시지만 남고, 답은 자동 생성된 thread로 분리됨.
      const promptText = r.kind === "mention" ? r.cleanText : r.raw;
      let targets: string[] = [];
      if (r.kind === "mention") {
        targets = r.agents.filter((a) => channel.agent_ids.includes(a));
        const unknown = r.agents.filter((a) => !channel.agent_ids.includes(a));
        for (const a of unknown) {
          const sysMsg = await insertMessage({
            sessionId: activeSession.id,
            role: "system",
            content: `@${a} 은 이 채널에 등록되지 않았습니다. /channel agents add ${a} 로 추가하세요.`,
          });
          setMessages((prev) => [...prev, sysMsg]);
        }
      } else if (r.kind === "plain") {
        const leader = pickChannelLeader(channel);
        if (leader) targets = [leader];
      }

      if (targets.length > 0) {
        // 1. user 메시지를 부모로 새 thread 생성
        const titleSrc = promptText.replace(/\s+/g, " ").trim();
        const title = titleSrc.length > 40 ? titleSrc.slice(0, 40) + "…" : titleSrc;
        let thread: Thread | null = null;
        try {
          thread = await createThread(activeSession.id, userMsg.id, title);
        } catch (e) {
          setError(toMsg(e));
        }
        if (thread) {
          // 2. agent는 thread 안에서 응답
          await Promise.all(
            targets.map((a) =>
              callAgentInThread(a, channel, workspace.root_path, activeSession.id, thread!.id, promptText),
            ),
          );
          // 3. thread 자동 open — 사용자가 후속 대화 가능
          openThreadTab(thread, userMsg);
        }
      }
    },
    [
      channels,
      selectedChannelId,
      workspaces,
      selectedWorkspaceId,
      activeSession,
      loadSessionAndMessages,
      reloadChannels,
      callAgent,
      callAgentInThread,
      dispatchDebateSpeaker,
      openThreadTab,
      reloadThreadSummaries,
    ],
  );

  // 키보드 단축키 (Ctrl+N 빈 파일 탭, Ctrl+G git 모달, Ctrl+/ 검색)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isEditable =
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" ||
          e.target.tagName === "TEXTAREA" ||
          e.target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n" && !isEditable) {
        e.preventDefault();
        openFileTab(null);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g" && !isEditable) {
        e.preventDefault();
        setGitFullOpen((o) => !o);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "/") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFileTab]);

  // Realtime 구독 — workspace 단위. 다른 디바이스/창 변경 즉시 반영.
  useEffect(() => {
    if (!selectedWorkspaceId) return;
    let subRef: RealtimeChannel | null = null;
    subRef = subscribeWorkspace(selectedWorkspaceId, {
      onMessageInsert: async (row) => {
        if (activeSession && row.session_id === activeSession.id && !row.thread_id) {
          setMessages((prev) => (prev.find((m) => m.id === row.id) ? prev : [...prev, row as Message]));
        }

        // 스레드 안 메시지면 활성 세션의 thread summaries 갱신 (chip count++)
        if (activeSession && row.session_id === activeSession.id && row.thread_id) {
          void reloadThreadSummaries();
        }

        // Auto-router: cron이 만든 user 메시지는 자동으로 mention 라우팅
        if (row.source === "cron" && row.role === "user" && row.thread_id) {
          try {
            const r = route(row.content);
            if (r.kind !== "mention") return;
            // session → channel 조회
            const sess = await supabase
              .from("chord_sessions")
              .select("channel_id")
              .eq("id", row.session_id)
              .maybeSingle();
            const channelId = sess.data?.channel_id;
            const channel = channels.find((c) => c.id === channelId);
            const ws = workspaces.find((w) => w.id === selectedWorkspaceId);
            if (!channel || !ws) return;
            const known = r.agents.filter((a) => channel.agent_ids.includes(a));
            // 스레드 안에서 응답 — callAgentInThread
            for (const a of known) {
              await callAgentInThread(a, channel, ws.root_path, row.session_id, row.thread_id, r.cleanText);
            }
          } catch (e) {
            console.error("auto-router failed", e);
          }
        }
      },
      onMessageUpdate: (row) => {
        if (activeSession && row.session_id === activeSession.id) {
          setMessages((prev) => prev.map((m) => (m.id === row.id ? (row as Message) : m)));
        }
      },
      onChannelChange: () => { void reloadChannels(); void reloadPinnedAndJobs(); },
      onSessionChange: () => {
        if (selectedChannelId) {
          const ch = channels.find((c) => c.id === selectedChannelId);
          if (ch) void loadSessionAndMessages(ch);
        }
        void reloadPinnedAndJobs();
      },
    });
    return () => {
      if (subRef) void unsubscribe(subRef);
    };
  }, [selectedWorkspaceId, activeSession, selectedChannelId, channels, workspaces, loadSessionAndMessages, reloadChannels, reloadPinnedAndJobs]);

  // ===== Cron Scheduler =====
  // chord 앱이 켜져 있는 동안만 동작. 매 분 due jobs 검사 + INSERT.
  // 시작 시 1회 즉시 실행 (catch-up: next_run_at가 과거면 바로 발화).
  useEffect(() => {
    if (!selectedWorkspaceId) return;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        const jobs = await listJobsForWorkspace(selectedWorkspaceId);
        const now = new Date();
        const due = jobs.filter(
          (j) => j.enabled && (!j.next_run_at || new Date(j.next_run_at) <= now),
        );
        for (const job of due) {
          if (!job.thread_id) continue;
          const thread = await getThread(job.thread_id);
          if (!thread) continue;
          const prompt = renderPromptTemplate(job.prompt_template, {
            date: todayISO(),
            time: now.toTimeString().slice(0, 5),
          });
          const content = `@${job.agent_name}  ${prompt}`;
          await supabase.from("chord_messages").insert({
            session_id: thread.session_id,
            thread_id: thread.id,
            role: "user",
            content,
            source: "cron",
          });
          await markJobRan(job);
        }
        if (due.length > 0) {
          await reloadPinnedAndJobs();
        }
      } catch (e) {
        console.error("scheduler tick failed", e);
      }
    };

    void tick(); // 즉시 1회
    const id = setInterval(() => void tick(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [selectedWorkspaceId, reloadPinnedAndJobs]);

  async function onStartThread(m: Message) {
    if (!activeSession) return;
    const title = m.content.slice(0, 40) + (m.content.length > 40 ? "…" : "");
    try {
      const t = await createThread(activeSession.id, m.id, title);
      openThreadTab(t, m);
    } catch (e) {
      setError(toMsg(e));
    }
  }

  // 채널 본문 메시지 편집·삭제. 스레드 안 편집은 ThreadView가 자체 처리.
  const onEditChannelMessage = useCallback(
    async (m: Message, newContent: string) => {
      try {
        await editMessageContent(m.id, newContent);
      } catch (e) {
        setError(toMsg(e));
        return;
      }
      setMessages((prev) =>
        prev.map((x) =>
          x.id === m.id ? { ...x, content: newContent, edited_at: new Date().toISOString() } : x,
        ),
      );

      // user 메시지 편집 시 — 새 스레드를 만들어 거기서 AI 재응답.
      if (m.role !== "user" || !activeSession) return;
      const channel = channels.find((c) => c.id === selectedChannelId);
      const workspace = workspaces.find((w) => w.id === selectedWorkspaceId);
      if (!channel || !workspace) return;

      const r = route(newContent);
      const promptText = r.kind === "mention" ? r.cleanText : r.raw;
      let targets: string[] = [];
      if (r.kind === "mention") {
        targets = r.agents.filter((a) => channel.agent_ids.includes(a));
      } else if (r.kind === "plain") {
        const leader = pickChannelLeader(channel);
        if (leader) targets = [leader];
      }
      if (targets.length === 0) return;

      const titleSrc = promptText.replace(/\s+/g, " ").trim();
      const title = titleSrc.length > 40 ? titleSrc.slice(0, 40) + "…" : titleSrc;
      let thread: Thread | null = null;
      try {
        thread = await createThread(activeSession.id, m.id, title);
      } catch (e) {
        setError(toMsg(e));
        return;
      }
      if (!thread) return;
      await Promise.all(
        targets.map((a) =>
          callAgentInThread(a, channel, workspace.root_path, activeSession.id, thread!.id, promptText),
        ),
      );
      openThreadTab(thread, m);
    },
    [
      activeSession,
      channels,
      selectedChannelId,
      workspaces,
      selectedWorkspaceId,
      callAgentInThread,
      openThreadTab,
    ],
  );

  const onDeleteChannelMessage = useCallback(async (m: Message) => {
    try {
      await softDeleteMessage(m.id);
    } catch (e) {
      setError(toMsg(e));
      return;
    }
    setMessages((prev) =>
      prev.map((x) => (x.id === m.id ? { ...x, deleted_at: new Date().toISOString() } : x)),
    );
  }, []);

  const selectedChannel = channels.find((c) => c.id === selectedChannelId);
  const workspaceRoot = workspaces.find((w) => w.id === selectedWorkspaceId)?.root_path ?? null;

  const activeTab = panelTabs.find((t) => t.id === activeTabId) ?? null;
  const tabMeta = panelTabs.map((t) => ({ id: t.id, kind: t.kind, title: t.title }));

  return (
    <div className="app">
      <Sidebar
        workspaces={workspaces}
        selectedWorkspaceId={selectedWorkspaceId}
        onSelectWorkspace={setSelectedWorkspaceId}
        channels={channels.filter((c) => showArchived || !c.archived)}
        selectedChannelId={selectedChannelId}
        onSelectChannel={setSelectedChannelId}
        activeSession={activeSession}
        workspaceRoot={workspaceRoot}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived((s) => !s)}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenFile={(path) => openFileTab(path)}
        onAttachToSession={async (path) => {
          if (!activeSession) {
            setError("active session이 없습니다.");
            return;
          }
          const { addSessionFile } = await import("./lib/sessionFiles");
          await addSessionFile(activeSession.id, path, "primary");
        }}
        pinnedThreads={pinnedThreads}
        scheduledJobs={scheduledJobs}
        onOpenPinnedThread={(t) => {
          setSelectedChannelId(t.channel_id);
          openThreadTab(t, null);
        }}
      />
      <main className="main">
        <div className="main-body">
          <div className="messages-pane">
            <header className="main-header">
              <div className="ch-title">
                {selectedChannel ? (
                  <>
                    <span className="hash">#</span>
                    {selectedChannel.name}
                  </>
                ) : (
                  "(채널을 선택하세요)"
                )}
              </div>
              {selectedChannel && (
                <div className="ch-meta">
                  <span>cwd: {selectedChannel.cwd ?? "(none)"} · agents: </span>
                  {selectedChannel.agent_ids.length > 0 ? (
                    selectedChannel.agent_ids.map((a) => (
                      <button
                        key={a}
                        className="agent-chip"
                        onClick={async () => {
                          let path = await resolveAgentPath(workspaceRoot ?? "", a);
                          if (!path) {
                            // 없으면 글로벌 위치를 새로 만들 path로 (저장 시 생성됨)
                            const home = await fsHomeDir();
                            path = `${home}/.claude/agents/${a}.md`;
                          }
                          openFileTab(path);
                        }}
                        title={`@${a} 정의 파일 열기`}
                      >
                        <AgentAvatar name={a} size={16} />
                        @{a}
                      </button>
                    ))
                  ) : (
                    <span>(none)</span>
                  )}
                  <span> · tools: {selectedChannel.allowed_tools.length}</span>
                </div>
              )}
            </header>
            <MessageList
              messages={messages}
              emptyHint={
                activeSession
                  ? "메시지가 없습니다. @coder 처럼 멘션, /session 으로 슬래시, ↳ thread 로 분기."
                  : "active session이 없습니다. /session start <name> 으로 시작."
              }
              onStartThread={onStartThread}
              workspaceRoot={workspaceRoot}
              onOpenFile={openFileTab}
              onEditSave={onEditChannelMessage}
              onDelete={onDeleteChannelMessage}
              onPickOption={(m, label) => {
                const author = m.agent_name ? `@${m.agent_name} ` : "";
                void onSend(`${author}${label}`);
              }}
              threadByParent={threadByParent}
              onOpenThread={(summary, parent) => {
                const t: Thread = {
                  id: summary.id,
                  session_id: activeSession?.id ?? "",
                  parent_message_id: summary.parent_message_id,
                  title: summary.title,
                  is_pinned: false,
                  name: summary.name,
                  created_at: "",
                };
                openThreadTab(t, parent);
              }}
            />
            {error && (
              <div className="banner-error" onClick={() => setError(null)} title="클릭하여 닫기">
                {error}
              </div>
            )}
            <Composer onSend={onSend} agents={selectedChannel?.agent_ids ?? []} />
          </div>

          {panelTabs.length > 0 && (
            <SidePanel
              tabs={tabMeta}
              activeId={activeTabId}
              onActivate={setActiveTabId}
              onClose={closeTab}
              width={panelWidth}
              onResizeStart={onResizeStart}
            >
              {activeTab?.kind === "thread" && selectedChannel && workspaceRoot && (
                <ThreadView
                  key={activeTab.id}
                  thread={activeTab.thread}
                  channel={selectedChannel}
                  workspaceRoot={workspaceRoot}
                  parentMessage={activeTab.parent}
                  onCallAgent={callAgentInThread}
                  onClose={() => closeTab(activeTab.id)}
                  onOpenFile={openFileTab}
                />
              )}
              {activeTab?.kind === "file" && workspaceRoot && (
                <Editor
                  key={activeTab.id}
                  root={workspaceRoot}
                  path={activeTab.path}
                  line={activeTab.line}
                  col={activeTab.col}
                  onClose={() => closeTab(activeTab.id)}
                />
              )}
            </SidePanel>
          )}
        </div>
      </main>

      {workspaceRoot && (
        <RightPanel
          workspaceRoot={workspaceRoot}
          activeSession={activeSession}
          onOpenGitFull={() => setGitFullOpen(true)}
        />
      )}

      {/* Git 풀 모달 */}
      <Modal open={gitFullOpen} title="⎇ git" onClose={() => setGitFullOpen(false)}>
        {workspaceRoot && <GitPanel root={workspaceRoot} full />}
      </Modal>

      {/* 검색 모달 */}
      <SearchModal
        open={searchOpen}
        workspaceId={selectedWorkspaceId}
        onClose={() => setSearchOpen(false)}
        onJump={(target) => {
          if (target.kind === "session" || target.kind === "message") {
            setSelectedChannelId(target.channelId);
          }
          setSearchOpen(false);
        }}
      />
    </div>
  );
}

async function refetchChannel(id: string): Promise<Channel | null> {
  const { data } = await supabase.from("chord_channels").select("*").eq("id", id).maybeSingle();
  return (data ?? null) as Channel | null;
}

// 채널 리더: agent_ids 중 이 우선순위로 일치하는 첫 에이전트.
// 매치 없으면 agent_ids[0] fallback.
const LEADER_PRIORITY = ["bd-manager", "sales-manager", "pm", "ma-manager"];
function pickChannelLeader(channel: Channel): string | null {
  for (const a of LEADER_PRIORITY) {
    if (channel.agent_ids.includes(a)) return a;
  }
  return channel.agent_ids[0] ?? null;
}

function toMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export default App;
