type Props = {
  name: string;
  size?: number;
  title?: string;
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

function initialsOf(name: string): string {
  const cleaned = name.replace(/^@/, "").trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/[\s_\-.]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const first = parts[0] ?? cleaned;
  return first.slice(0, 2).toUpperCase();
}

export function AgentAvatar({ name, size = 22, title }: Props) {
  const h = hash(name);
  const hue = h % 360;
  const sat = 55 + (h % 25);
  const light1 = 38;
  const light2 = 58;
  const bg = `linear-gradient(135deg, hsl(${hue} ${sat}% ${light1}%), hsl(${(hue + 35) % 360} ${sat}% ${light2}%))`;
  const initials = initialsOf(name);
  const fontSize = Math.round(size * 0.46);
  return (
    <span
      className="agent-avatar"
      title={title ?? `@${name}`}
      aria-label={`@${name}`}
      style={{
        width: size,
        height: size,
        background: bg,
        fontSize,
        lineHeight: `${size}px`,
      }}
    >
      {initials}
    </span>
  );
}
