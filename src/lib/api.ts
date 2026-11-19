export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json() : null;

  if (!res.ok) {
    const msg =
      (payload && typeof payload.error === 'string' && payload.error) ||
      `خطای سرور (${res.status})`;
    throw new ApiError(msg, res.status);
  }

  if (payload === null || typeof payload !== 'object') {
    throw new ApiError('پاسخ معتبر JSON از سرور دریافت نشد.', res.status || 502);
  }

  return payload as T;
}

export async function fetchAuthenticatedBlobUrl(
  url: string,
  token: string
): Promise<string> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    throw new ApiError('خطا در دریافت فایل از سرور', res.status);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
