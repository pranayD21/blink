"use client";

import { usePathname } from "next/navigation";

/** Hides the app header on the desktop windows (the pill), which show nothing but their own content. */
export function HeaderGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/desktop") || pathname === "/login" || pathname === "/") return null;
  return <>{children}</>;
}
