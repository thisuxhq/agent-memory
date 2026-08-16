const encoder = new TextEncoder();

export async function sha256Hex(input: string, bytes = 16): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return [...new Uint8Array(digest).slice(0, bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function messageId(
  sessionId: string,
  role: string,
  content: string,
): Promise<string> {
  return sha256Hex(`${sessionId}\0${role}\0${content}`);
}

export async function deriveSessionId(
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const payload = messages.map((msg) => `${msg.role}:${msg.content}`).join("\n");
  return sha256Hex(payload);
}

export function profileName(namespace: string, profile: string): string {
  return `${namespace}:${profile}`;
}

export function normalizeTopicKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return key || null;
}

export function utf8Bytes(value: string): number {
  return encoder.encode(value).byteLength;
}

export function encodeCursor(createdAt: number, id: string): string {
  return btoa(`${createdAt}:${id}`);
}

export function decodeCursor(cursor: string): { createdAt: number; id: string } {
  const decoded = atob(cursor);
  const sep = decoded.indexOf(":");
  if (sep <= 0) throw new Error("Invalid cursor");
  const createdAt = Number(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (!Number.isFinite(createdAt) || !id) throw new Error("Invalid cursor");
  return { createdAt, id };
}
