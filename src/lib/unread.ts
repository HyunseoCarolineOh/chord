// 채널·스레드 unread 상태 — localStorage 기반 (단일 기기).
// 새 메시지 들어올 때 setUnreadChannel/setUnreadThread, 채널/스레드 열 때 clearUnread*.

const LS_KEY = "chord.unread.v1";

type UnreadState = {
  channels: Record<string, boolean>;
  threads: Record<string, boolean>;
};

function read(): UnreadState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { channels: {}, threads: {} };
    const parsed = JSON.parse(raw);
    return {
      channels: parsed.channels ?? {},
      threads: parsed.threads ?? {},
    };
  } catch {
    return { channels: {}, threads: {} };
  }
}

function write(s: UnreadState): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
}

export function getUnreadState(): UnreadState {
  return read();
}

export function setUnreadChannel(channelId: string, value = true): UnreadState {
  const s = read();
  if (value) s.channels[channelId] = true;
  else delete s.channels[channelId];
  write(s);
  return s;
}

export function setUnreadThread(threadId: string, value = true): UnreadState {
  const s = read();
  if (value) s.threads[threadId] = true;
  else delete s.threads[threadId];
  write(s);
  return s;
}

export function clearUnreadChannel(channelId: string): UnreadState {
  return setUnreadChannel(channelId, false);
}

export function clearUnreadThread(threadId: string): UnreadState {
  return setUnreadThread(threadId, false);
}
