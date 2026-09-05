import { customerAuth } from './auth';

export interface PortalRequestOptions extends RequestInit {
  data?: unknown;
}

export async function portalApiRequest<T = any>(
  endpoint: string,
  options: PortalRequestOptions = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});

  let body = options.body;
  if (options.data !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.data);
  }

  if (customerAuth.state.token) {
    headers.set('Authorization', `Bearer ${customerAuth.state.token}`);
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
    body,
  });

  if (!response.ok) {
    let errorData: any = null;
    try {
      errorData = await response.json();
    } catch {
      errorData = { message: `Request failed with status ${response.status}` };
    }
    const err = new Error(errorData.message || errorData.error || `HTTP ${response.status}`);
    (err as any).status = response.status;
    (err as any).data = errorData;
    throw err;
  }

  return response.json();
}
