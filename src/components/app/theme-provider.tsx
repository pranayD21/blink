"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/** Follows the system light or dark setting; the chosen theme is a class on <html>. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}
