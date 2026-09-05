import { reactive } from 'vue';
import { apiRequest } from './api';

export interface User {
  id: string;
  email: string;
  name?: string;
  role: string;
}

export interface OrganizationProfile {
  id: string;
  name: string;
  slug: string;
  status: string;
  logoUrl?: string | null;
  address?: string | null;
  description?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  website?: string | null;
  currency: string;
  timezone: string;
  onboardingCompleted: boolean;
}

interface AuthState {
  token: string | null;
  user: User | null;
  organization: OrganizationProfile | null;
  isLoading: boolean;
}

function safeJsonParse<T>(val: string | null): T | null {
  if (!val) return null;
  try {
    return JSON.parse(val) as T;
  } catch {
    return null;
  }
}

const state = reactive<AuthState>({
  token: localStorage.getItem('dealflow_token'),
  user: safeJsonParse<User>(localStorage.getItem('dealflow_user')),
  organization: safeJsonParse<OrganizationProfile>(localStorage.getItem('dealflow_org')),
  isLoading: false,
});

export const authStore = {
  state,

  setAuth(token: string, user: User, organization?: Partial<OrganizationProfile>) {
    state.token = token;
    state.user = user;
    localStorage.setItem('dealflow_token', token);
    localStorage.setItem('dealflow_user', JSON.stringify(user));
    if (organization) {
      this.updateOrg(organization);
    } else {
      state.organization = null;
      localStorage.removeItem('dealflow_org');
    }
  },

  updateOrg(org: Partial<OrganizationProfile>) {
    if (state.organization) {
      state.organization = { ...state.organization, ...org };
    } else {
      state.organization = org as OrganizationProfile;
    }
    localStorage.setItem('dealflow_org', JSON.stringify(state.organization));
  },

  async fetchProfile() {
    if (!state.token) return;
    try {
      state.isLoading = true;
      const profile = await apiRequest<OrganizationProfile>('/api/organization/profile');
      this.updateOrg(profile);
      return profile;
    } catch {
      // Ignored if unauthenticated
    } finally {
      state.isLoading = false;
    }
  },

  logout() {
    state.token = null;
    state.user = null;
    state.organization = null;
    localStorage.removeItem('dealflow_token');
    localStorage.removeItem('dealflow_user');
    localStorage.removeItem('dealflow_org');
  },

  isAuthenticated() {
    return !!state.token;
  },
};
