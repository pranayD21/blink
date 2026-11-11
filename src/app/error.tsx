"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/report-client-error";

/**
 * A page that crashed. The header stays, the crash goes to the server log, and the visitor can try
 * again. (Without this file Next replaced the whole app with its own blank error screen.)
 */
export default function PageError({ error, retry }: { error: unknown; retry: () => void }) {
  const router = useRouter();
  useEffect(() => reportClientError(error, "segment"), [error]);
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start justify-center gap-4 px-6 py-24" data-testid="page-error">
      <h1 className="text-3xl tracking-tight">This page hit a problem.</h1>
      <p className="text-lg text-muted-foreground">It was reported. Try again, or go back to Cases.</p>
      <div className="flex gap-3">
        <Button type="button" onClick={() => retry()}>
          Try again
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/cases")}>
          Cases
        </Button>
      </div>
    </main>
  );
}
