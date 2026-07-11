const BASE = "/api/v1";
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class ApiError extends Error {
  constructor(
    readonly type: string,
    override readonly message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
  /** Zod flatten() field errors when the API attached them, else {}. */
  fieldErrors(): Record<string, string[]> {
    const d = this.detail as { fieldErrors?: Record<string, string[]> } | undefined;
    return d?.fieldErrors ?? {};
  }
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]!) : null;
}

type FetchOpts = { method?: string; body?: unknown; formData?: FormData; signal?: AbortSignal };

export async function apiFetch<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {};
  if (MUTATING.has(method)) {
    const csrf = readCookie("csrf_token");
    if (csrf) headers["x-csrf-token"] = csrf;
  }
  let payload: BodyInit | undefined;
  if (opts.formData) {
    payload = opts.formData; // browser sets multipart boundary
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(opts.body);
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: payload,
    credentials: "include",
    signal: opts.signal,
  });
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    const p = (data ?? {}) as { type?: string; title?: string; detail?: unknown };
    throw new ApiError(p.type ?? "error", p.title ?? res.statusText, res.status, p.detail);
  }
  return data as T;
}
