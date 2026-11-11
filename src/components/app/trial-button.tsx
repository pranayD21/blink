"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { startTrial } from "./trial-coach";

/** Opens the sample call and starts the walkthrough. */
export function TrialButton() {
  const router = useRouter();
  return (
    <Button
      type="button"
      className="h-11 px-5"
      data-testid="start-trial"
      onClick={() => {
        startTrial();
        router.push("/trial");
      }}
    >
      Walk me through a trial
    </Button>
  );
}
