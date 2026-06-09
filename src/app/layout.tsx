import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/contexts/AuthContext";
import { ErrorProvider } from "@/lib/contexts/ErrorContext";
import MainLayoutClientWrapper from "@/components/MainLayoutClientWrapper";
import { ThemeProvider } from "@/lib/contexts/ThemeContext";

const inter = Inter({ subsets: ["latin"] });

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
      <body className={`${inter.className} bg-white dark:bg-gray-900 transition-colors duration-200`}>
        <ThemeProvider>
          <AuthProvider>
            <ErrorProvider>
              <MainLayoutClientWrapper>
                {children}
              </MainLayoutClientWrapper>
            </ErrorProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
