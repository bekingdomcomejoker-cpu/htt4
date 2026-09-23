export type OperatorSession = {
  url: string;
  key: string;
};

export function serializeOperatorSession(session: OperatorSession): string {
  return JSON.stringify({ url: session.url.trim(), key: session.key.trim() });
}

export function parseOperatorSession(value: string | null): OperatorSession | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<OperatorSession>;
    if (typeof parsed.url !== "string" || typeof parsed.key !== "string") return null;
    const url = parsed.url.trim();
    const key = parsed.key.trim();
    if (!/^https?:\/\//i.test(url) || key.length < 8) return null;
    return { url, key };
  } catch {
    return null;
  }
}
