export interface RequestOptions extends RequestInit {
  data?: unknown;
}

export async function apiRequest<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
  const token = localStorage.getItem('dealflow_token');
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let body = options.body;
  if (options.data !== undefined) {
    if (options.data instanceof FormData) {
      body = options.data;
      // Do not set Content-Type for FormData, browser sets boundary
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.data);
    }
  } else if (body && typeof body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers,
    body,
  });

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg = json?.error || `Request failed with status ${response.status}`;
    throw new Error(errorMsg);
  }

  return json?.data !== undefined ? json.data : json;
}
