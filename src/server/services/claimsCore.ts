/** Claim rows: insert a version with its quotes and links, and compute its content hash. */
import { eq } from "drizzle-orm";
import { claimHash } from "@/core/deps/hash";
import { effectiveFields } from "@/core/predicates/evaluate";
import type { ClaimFields } from "@/core/types";
import { nowIso } from "../clock";
import { type DbOrTx, toJson } from "../db/client";
import { claimLinks, claimQuotes, claims } from "../db/schema";
import { newId } from "../ids";
import type { ClaimMeta, ClaimRow } from "./loaders";

export interface NewClaimQuote {
  turnId: string;
  turnTextHash: string;
  quote: string;
  start: number;
  end: number;
  role: "primary" | "context" | "correction" | "source_attribution";
  supportsFields: string[];
  normalized: boolean;
}

export interface NewClaimVersion {
  caseId: string;
  runId: string;
  logicalKey: string;
  versionNo: number;
  status: ClaimRow["status"];
  asserted: ClaimFields;
  verified: Partial<ClaimFields> | null;
  meta: ClaimMeta;
  quotes: NewClaimQuote[];
  links: { linkedLogicalKey: string; kind: "elaborates" | "corrects" | "attributes_source" | "contradicts" }[];
}

export function computeClaimHash(asserted: ClaimFields, verified: Partial<ClaimFields> | null, quotes: readonly { turnTextHash: string; start: number; end: number; role: string }[]): string {
  return claimHash({ fields: asserted, verified, quotes: quotes.map((q) => ({ turnTextHash: q.turnTextHash, start: q.start, end: q.end, role: q.role })) });
}

export function insertClaimVersion(tx: DbOrTx, input: NewClaimVersion): ClaimRow {
  const verified = input.verified && Object.keys(input.verified).length > 0 ? input.verified : null;
  const { fields } = effectiveFields({ asserted: input.asserted, verified });
  const row: ClaimRow = {
    id: newId("clm"),
    caseId: input.caseId,
    runId: input.runId,
    logicalKey: input.logicalKey,
    versionNo: input.versionNo,
    supersededBy: null,
    status: input.status,
    fieldsJson: toJson(fields),
    assertedJson: toJson(input.asserted),
    verifiedJson: verified ? toJson(verified) : null,
    metaJson: toJson(input.meta),
    contentHash: computeClaimHash(input.asserted, verified, input.quotes),
    createdAt: nowIso(),
  };
  tx.insert(claims).values(row).run();
  for (const q of input.quotes) {
    tx.insert(claimQuotes)
      .values({ id: newId("cq"), claimId: row.id, turnId: q.turnId, quote: q.quote, startChar: q.start, endChar: q.end, role: q.role, supportsFieldsJson: toJson(q.supportsFields), normalized: q.normalized, turnTextHash: q.turnTextHash })
      .run();
  }
  for (const link of input.links) {
    tx.insert(claimLinks).values({ id: newId("cl"), claimId: row.id, linkedClaimId: null, linkedLogicalKey: link.linkedLogicalKey, kind: link.kind }).run();
  }
  return row;
}

export function supersedeClaim(tx: DbOrTx, oldId: string, newId_: string): void {
  tx.update(claims).set({ supersededBy: newId_ }).where(eq(claims.id, oldId)).run();
}
