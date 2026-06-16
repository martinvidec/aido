import type { Config } from "tailwindcss";

const config: Config = {
  // Single theme mechanism (issue #84): `dark:` variants key off the same
  // `data-theme="dark"` attribute that drives the redesign oklch tokens, so
  // ThemeContext no longer needs a parallel `.dark` class for the legacy UI.
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Redesign design tokens (issue #39). Map onto the CSS variables defined
      // in src/app/globals.css so utilities like `bg-bg-card`, `text-text-dim`,
      // `border-border`, `bg-accent-soft`, `text-accent-text` follow the active theme.
      colors: {
        bg: {
          DEFAULT: "var(--bg)",
          side: "var(--bg-side)",
          card: "var(--bg-card)",
          pop: "var(--bg-pop)",
        },
        "row-hover": "var(--row-hover)",
        border: "var(--border)",
        text: {
          DEFAULT: "var(--text)",
          dim: "var(--text-dim)",
        },
        "check-border": "var(--check-border)",
        accent: {
          DEFAULT: "var(--accent)",
          soft: "var(--accent-soft)",
          text: "var(--accent-text)",
        },
        mention: {
          DEFAULT: "var(--mention)",
          bg: "var(--mention-bg)",
        },
        tag: "var(--tag)",
        wait: {
          text: "var(--wait-text)",
          bg: "var(--wait-bg)",
        },
        danger: "var(--danger)",
        "nav-bg": "var(--nav-bg)",
      },
      fontFamily: {
        // Nunito for UI, JetBrains Mono for #tags and numbers (issue #39).
        sans: ["var(--font-nunito)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: [
          "var(--font-jetbrains-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      boxShadow: {
        soft: "var(--shadow)",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic": "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
    },
  },
  plugins: [],
};
export default config;
