import { reactive } from 'vue';

export interface CustomerAuthPayload {
  token: string | null;
  orgId: string | null;
  quotationIds: string[];
  email: string | null;
  customerName: string | null;
}

const STORAGE_KEY = 'dealflow_customer_token';

function parseJwt(token: string) {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

class CustomerAuthStore {
  state = reactive<CustomerAuthPayload>({
    token: null,
    orgId: null,
    quotationIds: [],
    email: null,
    customerName: null,
  });

  constructor() {
    this.initFromStorage();
  }

  initFromStorage() {
    const token = localStorage.getItem(STORAGE_KEY);
    if (token) {
      this.setToken(token);
    }
  }

  setToken(token: string) {
    const payload = parseJwt(token);
    if (!payload || !payload.org_id) {
      this.clearToken();
      return;
    }

    this.state.token = token;
    this.state.orgId = payload.org_id;
    this.state.quotationIds = payload.quotation_ids || [];
    this.state.email = payload.email || null;
    this.state.customerName = payload.name || null;

    localStorage.setItem(STORAGE_KEY, token);
  }

  clearToken() {
    this.state.token = null;
    this.state.orgId = null;
    this.state.quotationIds = [];
    this.state.email = null;
    this.state.customerName = null;
    localStorage.removeItem(STORAGE_KEY);
  }
}

export const customerAuth = new CustomerAuthStore();
