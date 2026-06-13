import type { Metadata } from "next";
import { Nunito, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/contexts/AuthContext";
import { ErrorProvider } from "@/lib/contexts/ErrorContext";
import { ThemeProvider } from "@/lib/contexts/ThemeContext";

// UI font (issue #39). Exposed as a CSS variable consumed by globals.css/Tailwind.
const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
  variable: "--font-nunito",
  display: "swap",
});

// Monospace for #tags and numbers (issue #39).
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Aido - Your Todo App",
  description: "Manage your tasks efficiently",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${nunito.variable} ${jetbrainsMono.variable}`}>
        <ThemeProvider>
          <AuthProvider>
            <ErrorProvider>
              {children}
            </ErrorProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
