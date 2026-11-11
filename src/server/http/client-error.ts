/**
 * Turns a crash report from the browser into one log line. Every field is optional, cut short and
 * stripped of line breaks, so one report is always one line and cannot forge another.
 */
const clean = (value: unknown, max: number): string | null => {
  if (typeof value !== "string" || value.length === 0) return null;
  const flat = value.replace(/[\r\n\t]+/g, " ⏎ ").replace(/[\u0000-\u001f\u007f]/g, "");
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

export function clientErrorLine(body: unknown, userAgent: string | null): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const message = clean(b.message, 300);
  if (!message) return null;
  const parts = [
    `path=${clean(b.path, 200) ?? "?"}`,
    `boundary=${clean(b.boundary, 20) ?? "?"}`,
    `name=${clean(b.name, 60) ?? "?"}`,
    `message=${JSON.stringify(message)}`,
  ];
  const digest = clean(b.digest, 40);
  if (digest) parts.push(`digest=${digest}`);
  const stack = clean(b.stack, 600);
  if (stack) parts.push(`stack=${JSON.stringify(stack)}`);
  const ua = clean(userAgent ?? undefined, 160);
  if (ua) parts.push(`ua=${JSON.stringify(ua)}`);
  return `[client-error] ${parts.join(" ")}`;
}
