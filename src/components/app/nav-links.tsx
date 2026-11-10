"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/cases") : pathname.startsWith(href));
  return (
    <nav className="flex items-center gap-1 text-sm">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={cn("rounded-md px-2.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground", active(l.href) && "bg-muted font-medium text-foreground")}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
