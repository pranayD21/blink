import { CallControl } from "@/components/live/call-control";
import { pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { callableCases, scriptedCallsAllowed } from "@/server/services/live";

const DEFAULT_PACE_MS = 1500;

/** `?pace=` for the scripted call, held to something a person or a test can follow. */
function paceOf(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.max(Math.round(n), 50), 10_000) : DEFAULT_PACE_MS;
}

/**
 * The control window of the banker's app: start a call on a case, stop it, and see that every
 * stage is working. It never shows what anyone said. `?source=script` plays the scripted call
 * instead of the microphone, only where scripted calls are allowed.
 */
export default async function DesktopPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await pageActor();
  const params = await searchParams;

  if (actor.role !== "analyst") {
    return (
      <main className="flex flex-1 flex-col gap-2 p-5 text-sm">
        <h1 className="font-semibold text-foreground">Blink</h1>
        <p className="text-muted-foreground" data-testid="not-a-banker">
          Calls are started by bankers. You are signed in as {actor.name}, who is not one.
        </p>
      </main>
    );
  }

  const scripted = params.source === "script" && scriptedCallsAllowed();
  return <CallControl banker={actor.name} cases={callableCases(getDb(), actor)} source={scripted ? { kind: "script", paceMs: paceOf(params.pace) } : { kind: "live" }} />;
}
