"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { startTrial } from "./trial-coach";

/** Starts the guided run from the top of the app. */
export function TrialButton() {
  const router = useRouter();
  return (
    <Button
      type="button"
      className="h-10 px-5 text-base"
      data-testid="start-trial"
      onClick={() => {
        startTrial();
        router.push("/trial");
      }}
    >
      Demo call
    </Button>
  );
}
