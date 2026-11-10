import { CallControl } from "@/components/live/call-control";
import { controlSourceOf } from "@/lib/live/control-source";
import { pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { callableCases, scriptedCallsAllowed } from "@/server/services/live";

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

  return <CallControl banker={actor.name} cases={callableCases(getDb(), actor)} source={controlSourceOf(params, scriptedCallsAllowed())} />;
}
