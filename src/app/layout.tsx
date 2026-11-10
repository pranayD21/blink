import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { ThemeProvider } from "@/components/app/theme-provider";
import { AppHeader } from "@/components/app/app-header";
import { HeaderGate } from "@/components/app/header-gate";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "Blink — expert-call compliance review",
  description: "Evidence-backed compliance review of expert calls. Synthetic demo data.",
  icons: { icon: "/icon.svg" },
};

// Every page reads the database and the session cookie, so nothing is prerendered.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ThemeProvider>
          <TooltipProvider delayDuration={200}>
            <HeaderGate>
              <AppHeader />
            </HeaderGate>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </TooltipProvider>
          <Toaster position="bottom-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
