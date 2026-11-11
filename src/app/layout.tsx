import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/app/theme-provider";
import { AppHeader } from "@/components/app/app-header";
import { HeaderGate } from "@/components/app/header-gate";
import { TrialCoach } from "@/components/app/trial-coach";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Blink — expert-call compliance review",
  description: "Evidence-backed compliance review of expert calls. Synthetic demo data.",
  icons: { icon: "/icon.svg" },
};

// Every page reads the database and the session cookie, so nothing is prerendered.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="relative flex min-h-full flex-col bg-background text-foreground">
        <div className="aurora-field aurora-fixed" aria-hidden />
        <svg className="pointer-events-none absolute size-0" aria-hidden>
          <defs>
            <filter id="container-glass" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="0.05 0.05" numOctaves="1" seed="1" result="turbulence" />
              <feGaussianBlur in="turbulence" stdDeviation="2" result="blurredNoise" />
              <feDisplacementMap in="SourceGraphic" in2="blurredNoise" scale="40" xChannelSelector="R" yChannelSelector="B" result="displaced" />
              <feGaussianBlur in="displaced" stdDeviation="3" result="finalBlur" />
              <feComposite in="finalBlur" in2="finalBlur" operator="over" />
            </filter>
          </defs>
        </svg>
        <ThemeProvider>
          <TooltipProvider delayDuration={200}>
            <div className="relative z-10 flex min-h-full min-w-0 flex-1 flex-col">
              <HeaderGate>
                <AppHeader />
              </HeaderGate>
              <div className="flex min-h-0 flex-1 flex-col">{children}</div>
              <TrialCoach />
            </div>
          </TooltipProvider>
          <Toaster position="bottom-right" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
