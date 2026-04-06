const CARE_ACCESS_TOKEN_LOCAL_STORAGE_KEY = "care_access_token";

/**
 * Parse an API error response body into a human-readable message.
 *
 * Handles common backend error shapes:
 *  - `{ detail: "..." }`                              → the detail string
 *  - `{ errors: [{ type, loc, msg, ... }] }`          → Pydantic validation errors
 *  - `[{ errors: [{ type, loc, msg, ... }] }]`        → array-wrapped Pydantic errors
 *  - `{ field: ["msg", ...], ... }`                    → DRF field-level errors
 *  - `["msg1", "msg2"]`                                → array of strings
 *  - plain string                                      → as-is
 */

interface PydanticError {
  type?: string;
  loc?: (string | number)[];
  msg?: string;
  input?: unknown;
  url?: string;
  ctx?: unknown;
}

function isPydanticError(item: unknown): item is PydanticError {
  return (
    typeof item === "object" && item !== null && "type" in item && "msg" in item
  );
}

function formatPydanticError(err: PydanticError): string {
  const message =
    typeof err.msg === "string"
      ? err.msg
      : typeof err.msg === "object"
        ? Object.values(err.msg as Record<string, string>)[0]
        : "Validation error";

  if (err.loc && err.loc.length > 0) {
    const field = err.loc.filter((l) => l !== "body").join(".");
    return field ? `${field}: ${message}` : message;
  }

  return message;
}

function formatPydanticErrors(errors: PydanticError[]): string {
  return errors.map(formatPydanticError).join("; ");
}

export function formatApiError(data: unknown): string {
  if (data === null || data === undefined) return "Unknown error";

  // Already a string (e.g. plain-text response)
  if (typeof data === "string") return data;

  // Top-level array: could be Pydantic-wrapped objects or plain strings
  if (Array.isArray(data)) {
    // [{ errors: [{ type, loc, msg }] }, ...]
    const pydanticMsgs: string[] = [];
    for (const item of data) {
      if (
        typeof item === "object" &&
        item !== null &&
        "errors" in item &&
        Array.isArray((item as Record<string, unknown>).errors) &&
        (item as Record<string, unknown[]>).errors.every(isPydanticError)
      ) {
        pydanticMsgs.push(
          formatPydanticErrors(
            (item as Record<string, PydanticError[]>).errors,
          ),
        );
      }
    }
    if (pydanticMsgs.length > 0) return pydanticMsgs.join("; ");

    // Plain string array: ["error1", "error2"]
    const msgs = data
      .map((item) => (typeof item === "string" ? item : formatApiError(item)))
      .filter(Boolean);
    return msgs.length > 0 ? msgs.join("; ") : "Unknown error";
  }

  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;

    // { detail: "..." } — most common DRF shape
    if (typeof obj.detail === "string") return obj.detail;

    // { detail: ["...", "..."] }
    if (Array.isArray(obj.detail)) {
      const msgs = obj.detail.filter(
        (item): item is string => typeof item === "string",
      );
      if (msgs.length > 0) return msgs.join("; ");
    }

    // { errors: [{ type, loc, msg, ... }] } — Pydantic validation errors
    if (Array.isArray(obj.errors) && obj.errors.every(isPydanticError)) {
      return formatPydanticErrors(obj.errors as PydanticError[]);
    }

    // DRF field-level errors: { field: ["msg"], field2: "msg", ... }
    const parts: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        const msgs = value
          .map((v) => {
            if (typeof v === "string") return v;
            if (isPydanticError(v)) return formatPydanticError(v);
            return formatApiError(v);
          })
          .filter(Boolean);
        if (msgs.length > 0) parts.push(`${key}: ${msgs.join(", ")}`);
      } else if (typeof value === "string") {
        parts.push(`${key}: ${value}`);
      } else if (typeof value === "object" && value !== null) {
        const nested = formatApiError(value);
        if (nested && nested !== "Unknown error") {
          parts.push(`${key}: ${nested}`);
        }
      }
    }

    if (parts.length > 0) return parts.join("; ");
  }

  return String(data);
}

export class APIError extends Error {
  message: string;
  data: unknown;
  status: number;

  constructor(message: string, data: unknown, status: number) {
    super(message);
    this.name = "AbortError";
    this.message = message;
    this.data = data;
    this.status = status;
  }
}

function resolveApiUrl(path: string) {
  const coreEnv = (window as Window & { __CORE_ENV__?: { apiUrl?: string } })
    .__CORE_ENV__;
  const envUrl =
    (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env
      ?.VITE_API_BASE_URL || "";
  const apiUrl = coreEnv?.apiUrl || envUrl;

  if (!apiUrl) {
    throw new Error(
      "API base URL is not configured. Set window.__CORE_ENV__.apiUrl or VITE_API_BASE_URL.",
    );
  }

  return `${apiUrl}${path}`;
}

export async function request<Response>(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const url = path.startsWith("http") ? path : resolveApiUrl(path);

  const defaultHeaders = {
    Authorization: `Bearer ${localStorage.getItem(
      CARE_ACCESS_TOKEN_LOCAL_STORAGE_KEY,
    )}`,
    "Content-Type": "application/json",
  };

  const requestInit = {
    ...(options ?? {}),
    headers: {
      ...defaultHeaders,
      ...(options?.headers ?? {}),
    },
  };

  const response = await fetch(url, requestInit);

  let data: unknown = null;
  const contentType = response.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    data = await response.json();
  } else if (contentType.includes("image/png")) {
    data = await response.blob();
  } else if (contentType.includes("application/pdf")) {
    data = await response.blob();
  } else if (contentType.includes("image")) {
    data = await response.blob();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    throw new APIError(formatApiError(data), data, response.status);
  }

  return data as Response;
}

export const queryString = (
  params?: Record<string, string | number | boolean | undefined | null>,
) => {
  if (!params) {
    return "";
  }

  const paramString = Object.entries(params)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    )
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join("&");

  return paramString ? `?${paramString}` : "";
};
