// Stable, content-derived hue so the same company always gets the same colour.
function hueFor(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

function initialsFor(name: string): string {
  const words = name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '··';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const hue = hueFor(name);
  const bg = `hsl(${hue}deg 65% 92%)`;
  const fg = `hsl(${hue}deg 60% 30%)`;
  const ring = `hsl(${hue}deg 50% 80%)`;
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        border: `1px solid ${ring}`,
      }}
      aria-hidden
    >
      {initialsFor(name)}
    </span>
  );
}
