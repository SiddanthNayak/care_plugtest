const CARE_ACCESS_TOKEN_LOCAL_STORAGE_KEY = "care_access_token";

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
    throw new APIError(
      typeof (data as { detail?: string })?.detail === "string"
        ? (data as { detail?: string }).detail!
        : JSON.stringify(data),
      data,
      response.status,
    );
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
