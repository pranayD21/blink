import { CallControl } from "@/components/live/call-control";
import { pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { callableCases } from "@/server/services/live";

/** One button starts the call. The page then shows what the agent is doing, and nothing that was said. */
export default async function CallPage() {
  const actor = await pageActor();

  if (actor.role !== "analyst") {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-xl">
        <p className="text-muted-foreground" data-testid="not-a-banker">
          Calls are started by bankers. You are signed in as {actor.name}.
        </p>
      </main>
    );
  }

  return <CallControl hero banker={actor.name} cases={callableCases(getDb(), actor)} source={{ kind: "live" }} />;
}
