import { HttpError } from "./validate";

const encoder = new TextEncoder();

function safeEqual(left: string, right: string): boolean {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

export function requireBearer(header: string | undefined, token: string | undefined): void {
  if (!token || !header?.startsWith("Bearer ")) {
    throw new HttpError(401, "Unauthorized");
  }
  if (!safeEqual(header.slice("Bearer ".length), token)) {
    throw new HttpError(401, "Unauthorized");
  }
}
