"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";

/** A glass bar. The selected item is a lens that slides to the next choice. */
export function GlassNav({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const root = useRef<HTMLElement>(null);
  const [thumb, setThumb] = useState({ x: 0, w: 0, on: false });
  const active = (href: string) => (href === "/cases" ? pathname === "/cases" || pathname.startsWith("/cases/") : pathname === href || pathname.startsWith(`${href}/`));

  useLayoutEffect(() => {
    const bar = root.current;
    const current = bar?.querySelector<HTMLElement>("[data-active='true']");
    if (!bar || !current) {
      setThumb((prev) => ({ ...prev, on: false }));
      return;
    }
    const place = () => {
      const from = bar.getBoundingClientRect();
      const to = current.getBoundingClientRect();
      setThumb({ x: to.left - from.left, w: to.width, on: true });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [pathname, links]);

  return (
    <nav ref={root} className="glass-nav relative flex items-center p-1 text-base" aria-label="Sections">
      <span className="glass-nav-thumb" style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w, opacity: thumb.on ? 1 : 0 }} aria-hidden />
      {links.map((link) => {
        const on = active(link.href);
        return (
          <Link key={link.href} href={link.href} data-active={on} className={on ? "glass-press relative z-10 px-3.5 py-1.5 text-foreground" : "glass-press relative z-10 px-3.5 py-1.5 text-muted-foreground"}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
