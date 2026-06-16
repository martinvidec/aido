"use client";

import React, { createContext, useState, useContext, useEffect, ReactNode, useCallback } from 'react';
import { usePathname } from 'next/navigation';

// Export the Theme type
export type Theme = 'light' | 'dark' | 'system';

// Canonical localStorage key for the persisted preference (design handoff, issue #39).
const STORAGE_KEY = 'aidoF-theme';
// Legacy key used before the redesign — read once for migration, then superseded.
const LEGACY_STORAGE_KEY = 'theme';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// applyTheme resolves the effective theme and applies it to <html> via the
// single `data-theme="light|dark"` attribute (issue #84): it drives the redesign
// oklch tokens (globals.css) AND Tailwind's `dark:` variants, which key off
// [data-theme="dark"] (tailwind.config.ts) — so there is one theme mechanism and
// the legacy UI can never disagree with the new UI about the active theme.
const applyTheme = (theme: Theme, pathname: string): 'light' | 'dark' => {
  let effectiveTheme: 'light' | 'dark';

  // Force dark mode for the login page
  if (pathname === '/login') {
    effectiveTheme = 'dark';
  } else if (theme === 'system') {
    effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } else {
    effectiveTheme = theme;
  }

  document.documentElement.setAttribute('data-theme', effectiveTheme);

  return effectiveTheme;
};

// Read the persisted preference (new key, falling back to the legacy key).
// Runs only in the browser; defaults to 'system' on the server / first paint.
const readStoredTheme = (): Theme => {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // Ignore storage access errors (e.g. privacy mode) and fall back to 'system'.
  }
  return 'system';
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  const pathname = usePathname();

  // Hydrate the preference from localStorage once on mount (cannot run on the server).
  useEffect(() => {
    setThemeState(readStoredTheme());
  }, []);

  // Effect to apply theme based on state and path initially and on path change
  useEffect(() => {
    const initialResolvedTheme = applyTheme(theme, pathname);
    setResolvedTheme(initialResolvedTheme);
  // Dependencies: theme state AND pathname
  }, [theme, pathname]);

  // Listen for system theme changes only if theme is 'system' AND not on login page
  useEffect(() => {
    if (theme !== 'system' || pathname === '/login') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
       // Re-apply system theme, considering the current path (which is not /login here)
      const newResolvedTheme = applyTheme('system', pathname);
      setResolvedTheme(newResolvedTheme);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  // Dependencies: theme state AND pathname
  }, [theme, pathname]);

  const setTheme = useCallback((newTheme: Theme) => {
    try {
      // Store the user's explicit choice, even if /login forces dark visually
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch (error) {
      console.error("Failed to set theme in localStorage", error);
    }
    setThemeState(newTheme);
    // applyTheme is handled by the [theme, pathname] effect
  }, []);

  const contextValue: ThemeContextType = {
    theme,       // The user's preference (light, dark, system)
    setTheme,    // Function to set the preference
    resolvedTheme // The currently applied theme (light or dark), considering /login override
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
