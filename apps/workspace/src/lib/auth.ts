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
  /**
   * Browser-renderable logo source. The logo endpoint requires the Bearer
   * token which an <img src> cannot send, so the UI renders this blob:
   * object URL instead (populated by fetchLogo()).
   */
  logoSrc?: string | null;
  address?: string | null;
  description?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  website?: string | null;
  currency: string;
  timezone: string;
  onboardingCompleted: boolean;
}

let logoObjectUrl: string | null = null;

/**
 * Fetches the org logo with the Authorization header and converts it into a
 * browser-renderable object URL. Reuses a single object URL per session.
 * Returns null (with a console warning) on failure so callers can surface it.
 */
export async function fetchLogoObjectUrl(): Promise<string | null> {
  if (!state.token) return null;
  try {
    const res = await fetch('/api/organization/logo', {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (!res.ok) {
      console.warn(`Logo fetch failed (HTTP ${res.status}) — header keeps the previous logo.`);
      return null;
    }
    const blob = await res.blob();
    if (logoObjectUrl) URL.revokeObjectURL(logoObjectUrl);
    logoObjectUrl = URL.createObjectURL(blob);
    return logoObjectUrl;
  } catch (err) {
    console.warn('Logo fetch failed:', err);
    return null;
  }
}

/** Allowed logo types and size limit, shared by onboarding + settings forms. */
export const LOGO_ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
export const LOGO_MAX_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Validates a logo File before upload. Returns null when valid, otherwise a
 * precise human-readable error message.
 */
export function validateLogoFile(file: File): string | null {
  if (!LOGO_ALLOWED_MIME_TYPES.includes(file.type as any)) {
    return `Unsupported logo format "${file.type || file.name.split('.').pop()}". Allowed: PNG, JPEG, WebP, SVG.`;
  }
  if (file.size > LOGO_MAX_SIZE_BYTES) {
    return `Logo is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Maximum allowed size is 5 MB.`;
  }
  return null;
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
      if (profile.logoUrl) {
        profile.logoSrc = await fetchLogoObjectUrl();
      }
      this.updateOrg(profile);
      return profile;
    } catch {
      // Ignored if unauthenticated
    } finally {
      state.isLoading = false;
    }
  },

  /**
   * Re-fetches the logo (after an upload) and refreshes logoSrc.
   */
  async refreshLogo() {
    const src = await fetchLogoObjectUrl();
    if (src) {
      this.updateOrg({ logoSrc: src });
    }
    return src;
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
