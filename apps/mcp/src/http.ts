// Every network call goes through here: no caching layer by default, a
// timeout, a clear error, and the time we fetched it so tools can stamp it.

export const USER_AGENT = "fantasy-labs-mcp/0.1 (personal use)";

export type Fetched<T> = { data: T; fetchedAt: string; headers: Headers };

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
  }
}

export async function fetchRaw(url: string, timeoutMs = 20_000): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json, text/csv, */*" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    throw new Error(`Could not reach ${new URL(url).host}: ${cause?.code ?? cause?.message ?? (e as Error).message}`);
  }
  if (!res.ok) {
    let body = "";
    try {
      body = (await res.text()).slice(0, 300);
    } catch {
      // ignore
    }
    throw new HttpError(`${res.status} ${res.statusText} from ${redact(url)} ${body}`.trim(), res.status, redact(url));
  }
  return res;
}

export async function fetchJson<T>(url: string, timeoutMs?: number): Promise<Fetched<T>> {
  const res = await fetchRaw(url, timeoutMs);
  const data = (await res.json()) as T;
  return { data, fetchedAt: new Date().toISOString(), headers: res.headers };
}

/** Hide API keys before a URL ends up in an error or a tool response. */
export function redact(url: string): string {
  return url.replace(/(apiKey|api_key|key)=[^&]+/gi, "$1=***");
}

/** Small in-process cache for large, slow-moving files (nflverse CSVs). */
const memo = new Map<string, { at: number; fetchedAt: string; value: unknown }>();

export async function memoize<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
  opts: { refresh?: boolean } = {},
): Promise<{ value: T; fetchedAt: string; cached: boolean }> {
  const hit = memo.get(key);
  if (!opts.refresh && hit && Date.now() - hit.at < ttlMs) {
    return { value: hit.value as T, fetchedAt: hit.fetchedAt, cached: true };
  }
  const value = await load();
  const fetchedAt = new Date().toISOString();
  memo.set(key, { at: Date.now(), fetchedAt, value });
  return { value, fetchedAt, cached: false };
}

export function clearMemo() {
  memo.clear();
}
