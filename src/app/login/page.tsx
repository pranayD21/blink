import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/app/login-form";
import { safeNextPath } from "@/lib/session";
import { authMode } from "@/server/auth/mode";
import { optionalPageActor } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in — Blink" };

/**
 * Sign in with a password (live guidance, section 5). `?next=` names the page to return to; only a
 * path on this site is followed. Someone already signed in, or a server using the role switcher,
 * goes straight there.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = safeNextPath((await searchParams).next);
  if (authMode() === "switcher" || (await optionalPageActor())) redirect(next);
  return <LoginForm next={next} />;
}
