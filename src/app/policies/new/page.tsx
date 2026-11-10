import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageShell } from "@/components/app/page-shell";
import { RoleGate } from "@/components/app/role-gate";
import { NewPolicyForm, type PolicyPreset } from "@/components/policy/new-policy-form";
import { Button } from "@/components/ui/button";
import { DEMO_USERS } from "@/server/auth/actor";
import { pageActor } from "@/server/auth/session";
import { fixturePolicyInput } from "@/server/services/seed";

function presets(): PolicyPreset[] {
  try {
    return (
      [
        ["Demo policy v1", "blink-demo-policy-v1.md"],
        ["Broken variant", "blink-demo-policy-v1-broken.md"],
      ] as const
    ).map(([label, file]) => {
      const input = fixturePolicyInput(file);
      return { label, title: input.title, text: input.text, requiredParagraphs: input.requiredParagraphs, scenarios: input.scenarios, scenarioCount: (input.scenarios as { scenarios: unknown[] }).scenarios.length };
    });
  } catch {
    return [];
  }
}

export default async function NewPolicyPage() {
  const actor = await pageActor();
  if (actor.role !== "policy_owner") {
    return <RoleGate title="Only the policy owner can create a policy version" message="Compiling and approving policy is the policy owner's responsibility." current={actor} switchTo={DEMO_USERS.filter((u) => u.role === "policy_owner")} />;
  }
  return (
    <PageShell
      title="New policy version"
      description="Paste the policy in plain language. Blink asks a model to inventory its clauses, turn them into typed rules, and assemble one monitor per rule. Code then validates the result. Nothing is used to evaluate a call until you approve the exact bundle hash."
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href="/policies">
            <ArrowLeft /> Policy versions
          </Link>
        </Button>
      }
    >
      <NewPolicyForm presets={presets()} />
    </PageShell>
  );
}
