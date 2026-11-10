import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { AppHeader } from "@/components/app/app-header";
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
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">
        <TooltipProvider delayDuration={200}>
          <AppHeader />
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </TooltipProvider>
        <Toaster theme="light" position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
