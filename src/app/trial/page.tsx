import { DemoRun } from "@/components/trial/demo-run";
import { pageActor } from "@/server/auth/session";

/** A sample call any signed-in person can watch Blink read. */
export default async function TrialPage() {
  await pageActor();
  return <DemoRun />;
}
