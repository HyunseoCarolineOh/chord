// 단순 cron parser — MVP용.
//   "daily HH:MM"   → 다음 HH:MM (이미 지났으면 내일)
//   "daily +Nm"     → N분 후 (테스트용)
//   "daily +Ns"     → N초 후 (테스트용)
//   "every Nm"      → 매 N분 (즉시 첫 실행 후 N분 간격)
export function parseNextRun(spec: string, base: Date = new Date()): Date | null {
  const s = spec.trim().toLowerCase();

  let m = s.match(/^daily\s+(\d{1,2}):(\d{2})$/);
  if (m) {
    const next = new Date(base);
    next.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
    if (next <= base) next.setDate(next.getDate() + 1);
    return next;
  }

  m = s.match(/^daily\s+\+(\d+)m$/);
  if (m) return new Date(base.getTime() + parseInt(m[1], 10) * 60_000);

  m = s.match(/^daily\s+\+(\d+)s$/);
  if (m) return new Date(base.getTime() + parseInt(m[1], 10) * 1_000);

  m = s.match(/^every\s+(\d+)m$/);
  if (m) return new Date(base.getTime() + parseInt(m[1], 10) * 60_000);

  return null;
}

export function renderPromptTemplate(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

export function todayISO(): string {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
