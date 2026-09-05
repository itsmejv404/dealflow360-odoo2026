import { ref, watchEffect } from 'vue';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'df360-theme';

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

function loadPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Non-fatal
  }
  return 'system';
}

const preference = ref<ThemePreference>(loadPreference());
let initialized = false;

function applyTheme() {
  const isDark = preference.value === 'dark' || (preference.value === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', isDark);
}

export function useTheme() {
  if (!initialized && typeof window !== 'undefined') {
    initialized = true;
    watchEffect(applyTheme);
    // React to OS-level theme changes while on "system".
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (preference.value === 'system') applyTheme();
    });
  }

  function setTheme(next: ThemePreference) {
    preference.value = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Non-fatal
    }
    applyTheme();
  }

  function toggleTheme() {
    const isDark = preference.value === 'dark' || (preference.value === 'system' && systemPrefersDark());
    setTheme(isDark ? 'light' : 'dark');
  }

  return { preference, setTheme, toggleTheme };
}
