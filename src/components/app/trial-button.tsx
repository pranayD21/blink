"use client";

import { Button } from "@/components/ui/button";
import { startTrial } from "./trial-coach";

/** Starts the guided run from the top of the app. */
export function TrialButton() {
  return (
    <Button type="button" className="h-11 px-5" data-testid="start-trial" onClick={startTrial}>
      Walk me through a trial
    </Button>
  );
}
