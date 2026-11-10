/**
 * Drizzle schema for every table in BLINK_BUILD_SPEC §6.1.
 *
 * Conventions:
 *  - IDs are prefixed ULIDs (text). Timestamps are ISO-8601 UTC text.
 *  - `*_json` columns hold canonical JSON text; parse with `fromJson`.
 *  - Every mutable row carries `version` for optimistic concurrency (D12).
 *
 * Columns that go beyond the spec's table list are marked `// +` with the
 * reason they exist.
 */
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { STAGES } from "@/core/live/health";

const version = () => integer("version").notNull().default(1);
const bool = (name: string) => integer(name, { mode: "boolean" }).notNull().default(false);

// ── People ──────────────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role", { enum: ["analyst", "reviewer", "senior_reviewer", "policy_owner"] }).notNull(),
});

// ── Curated public documents (§11) ──────────────────────────────────────────

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  sourceType: text("source_type", {
    enum: ["filing", "press_release", "transcript", "industry_report", "news"],
  }).notNull(),
  issuer: text("issuer").notNull(),
  relatedIssuersJson: text("related_issuers_json").notNull().default("[]"), // + §17.5 `related_issuers`
  publishedAt: text("published_at").notNull(),
  ingestedAt: text("ingested_at").notNull(),
  urlLabel: text("url_label").notNull(),
  body: text("body").notNull(),
  bodyHash: text("body_hash").notNull(),
  factsJson: text("facts_json").notNull().default("[]"),
  factsStatus: text("facts_status", { enum: ["pending", "extracted", "failed"] }) // + shows extraction progress
    .notNull()
    .default("pending"),
  factsCallId: text("facts_call_id"), // + llm_calls row that produced the facts
  version: version(),
});

export const documentSets = sqliteTable("document_sets", {
  id: text("id").primaryKey(),
  hash: text("hash").notNull(),
  documentIdsJson: text("document_ids_json").notNull(),
});

// ── Policy (§8) ─────────────────────────────────────────────────────────────

export const policySources = sqliteTable("policy_sources", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  text: text("text").notNull(),
  textHash: text("text_hash").notNull(),
  requiredParagraphsJson: text("required_paragraphs_json").notNull().default("[]"),
  scenariosJson: text("scenarios_json"), // + reviewer-authored scenarios attached to this policy (§8.6)
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});

export const policyVersions = sqliteTable("policy_versions", {
  id: text("id").primaryKey(),
  policySourceId: text("policy_source_id").notNull(),
  label: text("label").notNull(),
  status: text("status", {
    enum: ["DRAFT", "COMPILING", "COMPILE_FAILED", "VALIDATED", "ACTIVE", "SUPERSEDED"],
  }).notNull(),
  compileSource: text("compile_source", { enum: ["ai", "manual"] }).notNull().default("ai"),
  inventoryJson: text("inventory_json"),
  rulesJson: text("rules_json"), // { rules, unsupported_clauses }
  monitorsJson: text("monitors_json"),
  validationJson: text("validation_json"), // { issues, enumeration }
  scenarioReportJson: text("scenario_report_json"),
  previewMd: text("preview_md"),
  bundleHash: text("bundle_hash"),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  activatedAt: text("activated_at"),
  supersededAt: text("superseded_at"),
  createdAt: text("created_at").notNull(), // +
  compileJobId: text("compile_job_id"), // + lets the UI poll the running compile
  version: version(),
});

export const compileAttempts = sqliteTable(
  "compile_attempts",
  {
    id: text("id").primaryKey(),
    policyVersionId: text("policy_version_id").notNull(),
    stage: text("stage").notNull(), // pass_a | pass_b | assembly | scenarios | validate | manual
    attemptNo: integer("attempt_no").notNull(),
    inputHash: text("input_hash").notNull(),
    outputJson: text("output_json"),
    issuesJson: text("issues_json").notNull().default("[]"),
    llmCallId: text("llm_call_id"), // + ties the attempt to its recorded model call
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("compile_attempts_pv_idx").on(t.policyVersionId)],
);

// ── Cases and inputs ────────────────────────────────────────────────────────

export const cases = sqliteTable("cases", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  issuer: text("issuer").notNull(),
  ticker: text("ticker").notNull(),
  status: text("status", {
    enum: [
      "INTAKE",
      "ANALYZING",
      "ANALYSIS_FAILED",
      "IN_REVIEW",
      "READY_FOR_APPROVAL",
      "APPROVED",
      "RELEASED",
      "STALE",
    ],
  }).notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  activePolicyVersionId: text("active_policy_version_id"),
  documentSetId: text("document_set_id"),
  version: version(),
});

export const packets = sqliteTable(
  "packets",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    versionNo: integer("version_no").notNull(),
    researchQuestionsJson: text("research_questions_json").notNull(),
    aliasesJson: text("aliases_json").notNull().default("[]"), // + §17.1 `aliases`
    issuerFiscalJson: text("issuer_fiscal_json").notNull(), // + §7.4 `issuer_fiscal`
    callDate: text("call_date").notNull(),
    expertId: text("expert_id").notNull(),
    analystNotes: text("analyst_notes").notNull().default(""),
    contentHash: text("content_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("packets_case_idx").on(t.caseId)],
);

export const experts = sqliteTable("experts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  currentEmployer: text("current_employer").notNull().default(""),
  currentTitle: text("current_title").notNull().default(""),
  employmentJson: text("employment_json").notNull().default("[]"),
  network: text("network").notNull().default(""),
  networkAttestationJson: text("network_attestation_json").notNull().default("{}"),
  contentHash: text("content_hash").notNull(),
});

export const transcriptVersions = sqliteTable(
  "transcript_versions",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    versionNo: integer("version_no").notNull(),
    sourceLabel: text("source_label").notNull(),
    rawText: text("raw_text").notNull(),
    contentHash: text("content_hash").notNull(),
    supersedesId: text("supersedes_id"),
    createdBy: text("created_by"), // +
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("transcript_versions_case_no_idx").on(t.caseId, t.versionNo)],
);

export const turns = sqliteTable(
  "turns",
  {
    id: text("id").primaryKey(), // `${transcriptVersionId}:T5`
    transcriptVersionId: text("transcript_version_id").notNull(),
    idx: integer("idx").notNull(), // 1-based
    label: text("label").notNull(), // + "T5": the stable per-version id shown in the UI and sent to the model
    speaker: text("speaker", { enum: ["analyst", "expert", "moderator"] }).notNull(),
    speakerName: text("speaker_name").notNull().default(""),
    timestamp: text("timestamp"), // + "[00:01:10]" as written in the source
    startChar: integer("start_char").notNull(),
    endChar: integer("end_char").notNull(),
    text: text("text").notNull(),
    textHash: text("text_hash").notNull(),
  },
  (t) => [index("turns_tv_idx").on(t.transcriptVersionId, t.idx)],
);

export const turnLineage = sqliteTable(
  "turn_lineage",
  {
    id: text("id").primaryKey(), // +
    transcriptVersionId: text("transcript_version_id").notNull(), // + the NEW version this row belongs to
    newTurnId: text("new_turn_id"), // null when change = removed
    oldTurnId: text("old_turn_id"), // null when change = added
    change: text("change", { enum: ["same", "edited", "added", "removed"] }).notNull(),
  },
  (t) => [index("turn_lineage_old_idx").on(t.oldTurnId), index("turn_lineage_new_idx").on(t.newTurnId)],
);

// ── Analysis (§10) ──────────────────────────────────────────────────────────

export const analysisRuns = sqliteTable(
  "analysis_runs",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    runNo: integer("run_no").notNull(), // + "run #3" in the workspace header
    transcriptVersionId: text("transcript_version_id").notNull(),
    packetId: text("packet_id").notNull(),
    policyVersionId: text("policy_version_id"),
    documentSetId: text("document_set_id"),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    source: text("source", { enum: ["ai", "gold"] }).notNull().default("ai"), // + dev-only gold loader is labeled
    status: text("status", { enum: ["running", "succeeded", "failed"] }).notNull(),
    stage: text("stage").notNull().default(""),
    error: text("error"),
    reportJson: text("report_json"), // + quote stats, rejected claims, suggested concerns
    callSummary: text("call_summary"), // + baseline mode only (§10.2)
    llmCallId: text("llm_call_id"), // +
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (t) => [index("analysis_runs_case_idx").on(t.caseId)],
);

export const claims = sqliteTable(
  "claims",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    runId: text("run_id").notNull(),
    logicalKey: text("logical_key").notNull(),
    versionNo: integer("version_no").notNull(),
    supersededBy: text("superseded_by"),
    status: text("status", { enum: ["proposed", "reviewer_corrected", "rejected"] }).notNull(),
    fieldsJson: text("fields_json").notNull(), // effective fields: verified ?? asserted
    assertedJson: text("asserted_json").notNull(),
    verifiedJson: text("verified_json"),
    metaJson: text("meta_json").notNull().default("{}"), // + solicited flag, uncertainty, conflicts, ungrounded fields
    contentHash: text("content_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("claims_case_key_idx").on(t.caseId, t.logicalKey)],
);

export const claimQuotes = sqliteTable(
  "claim_quotes",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id").notNull(),
    turnId: text("turn_id").notNull(),
    quote: text("quote").notNull(),
    startChar: integer("start_char").notNull(), // offsets inside the turn text
    endChar: integer("end_char").notNull(),
    role: text("role", { enum: ["primary", "context", "correction", "source_attribution"] }).notNull(),
    supportsFieldsJson: text("supports_fields_json").notNull().default("[]"), // + §10.2 supports_fields
    normalized: bool("normalized"), // + matched after whitespace/quote normalization (§10.3)
    turnTextHash: text("turn_text_hash").notNull(), // + content-addresses the quote across transcript versions
  },
  (t) => [index("claim_quotes_claim_idx").on(t.claimId), index("claim_quotes_turn_idx").on(t.turnId)],
);

export const claimLinks = sqliteTable(
  "claim_links",
  {
    id: text("id").primaryKey(),
    claimId: text("claim_id").notNull(),
    linkedClaimId: text("linked_claim_id"),
    linkedLogicalKey: text("linked_logical_key").notNull(), // + survives claim re-versioning
    kind: text("kind", { enum: ["elaborates", "corrects", "attributes_source", "contradicts"] }).notNull(),
  },
  (t) => [index("claim_links_claim_idx").on(t.claimId)],
);

export const contextFacts = sqliteTable(
  "context_facts",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    key: text("key").notNull(), // e.g. `public_match:C3`, `clarification:<taskId>`
    claimLogicalKey: text("claim_logical_key"), // +
    valueJson: text("value_json").notNull(),
    evidenceState: text("evidence_state", { enum: ["supported", "refuted", "unknown", "conflict"] }).notNull(),
    source: text("source", { enum: ["packet", "expert", "comparison", "reviewer", "clarification"] }).notNull(),
    sourceRef: text("source_ref"),
    contentHash: text("content_hash").notNull(),
    createdAt: text("created_at").notNull(),
    supersededBy: text("superseded_by"),
  },
  (t) => [index("context_facts_case_key_idx").on(t.caseId, t.key)],
);

export const predicateAssessments = sqliteTable(
  "predicate_assessments",
  {
    id: text("id").primaryKey(),
    runId: text("run_id"),
    claimId: text("claim_id").notNull(),
    predicate: text("predicate").notNull(),
    paramsJson: text("params_json").notNull().default("{}"),
    state: text("state", { enum: ["supported", "refuted", "unknown", "conflict"] }).notNull(),
    evidenceRefsJson: text("evidence_refs_json").notNull().default("[]"),
    explanation: text("explanation").notNull().default(""),
  },
  (t) => [index("predicate_assessments_claim_idx").on(t.claimId)],
);

// ── Runtime (§9) ────────────────────────────────────────────────────────────

export const monitorInstances = sqliteTable(
  "monitor_instances",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    claimLogicalKey: text("claim_logical_key").notNull(),
    policyVersionId: text("policy_version_id").notNull(),
    monitorId: text("monitor_id").notNull(),
    ruleId: text("rule_id").notNull(), // +
    state: text("state").notNull(),
    version: version(),
  },
  (t) => [
    uniqueIndex("monitor_instances_key_idx").on(t.caseId, t.claimLogicalKey, t.policyVersionId, t.monitorId),
  ],
);

export const monitorEvaluations = sqliteTable(
  "monitor_evaluations",
  {
    id: text("id").primaryKey(),
    instanceId: text("instance_id").notNull(),
    seq: integer("seq").notNull(),
    eventType: text("event_type").notNull(),
    eventId: text("event_id").notNull(),
    prevState: text("prev_state").notNull(),
    nextState: text("next_state").notNull(),
    transitionId: text("transition_id"),
    result: text("result").notNull(), // + guard tri-value, for the history chips
    turnLabel: text("turn_label"), // + set on turn-ordered events ("T5")
    conflictFlag: bool("conflict_flag"), // +
    guardTraceJson: text("guard_trace_json").notNull(),
    effectsJson: text("effects_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("monitor_evaluations_seq_idx").on(t.instanceId, t.seq)],
);

export const findings = sqliteTable(
  "findings",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    claimLogicalKey: text("claim_logical_key"),
    origin: text("origin", { enum: ["policy", "ai_suggested", "reviewer", "live"] }).notNull(),
    monitorInstanceId: text("monitor_instance_id"),
    title: text("title").notNull(),
    severity: text("severity", { enum: ["high", "medium", "low"] }).notNull(),
    state: text("state", {
      enum: [
        "NEEDS_CONTEXT",
        "REVIEW_REQUIRED",
        "NOT_TRIGGERED_PENDING_ACK",
        "ESCALATED",
        "DISPOSITIONED",
        "REOPENED",
      ],
    }).notNull(),
    reasonCodesJson: text("reason_codes_json").notNull().default("[]"),
    explanation: text("explanation").notNull().default(""),
    missingContextJson: text("missing_context_json").notNull().default("[]"),
    dedupeKey: text("dedupe_key").notNull(), // + replay of re-evaluation creates no duplicates (§9.1 step 4)
    seqNo: integer("seq_no").notNull(), // + stable "F1…Fn" label per case
    createdBy: text("created_by"), // +
    createdAt: text("created_at").notNull(), // +
    version: version(),
  },
  (t) => [uniqueIndex("findings_dedupe_idx").on(t.dedupeKey), index("findings_case_idx").on(t.caseId)],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    findingId: text("finding_id").notNull(),
    monitorInstanceId: text("monitor_instance_id"), // +
    kind: text("kind", { enum: ["context", "review", "escalation", "clarification"] }).notNull(),
    status: text("status", { enum: ["open", "done", "cancelled"] }).notNull(),
    question: text("question").notNull().default(""),
    answer: text("answer"),
    assignedRole: text("assigned_role").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    metaJson: text("meta_json").notNull().default("{}"), // + rule id, unknown predicates, question source
    createdAt: text("created_at").notNull(), // +
    closedAt: text("closed_at"), // +
    closedBy: text("closed_by"), // +
    version: version(),
  },
  (t) => [uniqueIndex("tasks_dedupe_idx").on(t.dedupeKey), index("tasks_finding_idx").on(t.findingId)],
);

export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(), // +
    findingId: text("finding_id").notNull(),
    actorId: text("actor_id").notNull(),
    kind: text("kind", { enum: ["disposition", "escalation_request", "escalation_decision"] }).notNull(),
    outcome: text("outcome", {
      enum: ["cleared_for_research", "restricted_exclude", "restricted_escalate_to_legal", "no_concern"],
    }),
    rationale: text("rationale").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    stale: bool("stale"),
    staleReason: text("stale_reason"), // +
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("decisions_finding_idx").on(t.findingId)],
);

export const attestations = sqliteTable(
  "attestations",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    actorId: text("actor_id").notNull(),
    transcriptVersionId: text("transcript_version_id").notNull(),
    kind: text("kind", { enum: ["whole_call_review"] }).notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    stale: bool("stale"),
    staleReason: text("stale_reason"), // +
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("attestations_case_idx").on(t.caseId)],
);

// ── Live calls ──────────────────────────────────────────────────────────────

export const calls = sqliteTable(
  "calls",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    startedBy: text("started_by").notNull(),
    policyVersionId: text("policy_version_id").notNull(),
    status: text("status", { enum: ["live", "ended", "abandoned"] }).notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    lastAmberAt: text("last_amber_at"), // drives "amber at most once in 30 seconds"
    transcriptVersionId: text("transcript_version_id"), // set when the call is ended and stored as a transcript
    analysisJobId: text("analysis_job_id"),
    readerModel: text("reader_model").notNull(),
    readerPromptVersion: text("reader_prompt_version").notNull(),
    hiddenCount: integer("hidden_count").notNull().default(0),
    version: version(),
  },
  (t) => [index("calls_case_idx").on(t.caseId)],
);

export const callTurns = sqliteTable(
  "call_turns",
  {
    id: text("id").primaryKey(), // `${callId}:${seq}`
    callId: text("call_id").notNull(),
    seq: integer("seq").notNull(),
    speaker: text("speaker", { enum: ["analyst", "expert"] }).notNull(),
    text: text("text").notNull(),
    textHash: text("text_hash").notNull(),
    speechStartMs: integer("speech_start_ms"),
    speechEndMs: integer("speech_end_ms").notNull(),
    speechEndedAt: text("speech_ended_at").notNull(),
    transcribedAt: text("transcribed_at").notNull(),
    receivedAt: text("received_at").notNull(),
    readMs: integer("read_ms"),
    rulesMs: integer("rules_ms"),
    decidedAt: text("decided_at").notNull(),
    responseReceivedAt: text("response_received_at"),
    shownAt: text("shown_at"),
    readStatus: text("read_status", { enum: ["read", "timeout", "refused", "error"] }).notNull(),
    llmCallId: text("llm_call_id"),
    claimsJson: text("claims_json").notNull().default("[]"),
    evaluationsJson: text("evaluations_json").notNull().default("[]"),
    rejectedJson: text("rejected_json").notNull().default("[]"),
    pill: text("pill", { enum: ["listening", "amber", "red"] }).notNull(),
    pillReason: text("pill_reason").notNull(),
    pillRuleIdsJson: text("pill_rule_ids_json").notNull().default("[]"),
    suppressed: bool("suppressed"),
    error: text("error"),
  },
  (t) => [uniqueIndex("call_turns_call_seq_idx").on(t.callId, t.seq)],
);

export const callClaims = sqliteTable(
  "call_claims",
  {
    id: text("id").primaryKey(), // `${callId}:${logicalKey}`
    callId: text("call_id").notNull(),
    logicalKey: text("logical_key").notNull(),
    recordJson: text("record_json").notNull(),
    monitorStatesJson: text("monitor_states_json").notNull().default("[]"),
    flagged: text("flagged", { enum: ["none", "needs_context", "review_required"] }).notNull(),
    ruleIdsJson: text("rule_ids_json").notNull().default("[]"),
    firstFlaggedSeq: integer("first_flagged_seq"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("call_claims_call_idx").on(t.callId)],
);

export const callOutages = sqliteTable(
  "call_outages",
  {
    id: text("id").primaryKey(),
    callId: text("call_id").notNull(),
    stage: text("stage", { enum: STAGES }).notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    cause: text("cause").notNull(),
    shownToBanker: bool("shown_to_banker"),
  },
  (t) => [index("call_outages_call_idx").on(t.callId)],
);

/** The span of a turn a live finding hid; offsets are inside the turn text. */
export const findingPassages = sqliteTable(
  "finding_passages",
  {
    id: text("id").primaryKey(),
    findingId: text("finding_id").notNull(),
    turnId: text("turn_id").notNull(),
    startChar: integer("start_char").notNull(),
    endChar: integer("end_char").notNull(),
  },
  (t) => [index("finding_passages_finding_idx").on(t.findingId)],
);

// ── Brief, approval, release (§12) ──────────────────────────────────────────

export const briefs = sqliteTable(
  "briefs",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    versionNo: integer("version_no").notNull(),
    status: text("status", { enum: ["draft", "approved", "released", "stale"] }).notNull(),
    bodyMd: text("body_md").notNull(),
    sentencesJson: text("sentences_json").notNull(), // BriefSection[]
    contentHash: text("content_hash").notNull(),
    audience: text("audience").notNull(),
    draftSource: text("draft_source", { enum: ["ai", "template", "edit"] }).notNull().default("ai"), // +
    issuesJson: text("issues_json").notNull().default("[]"), // + dropped sentences (§12.6)
    withheldCount: integer("withheld_count").notNull().default(0), // + "N statements withheld by compliance"
    eligibleCount: integer("eligible_count").notNull().default(0), // +
    llmCallId: text("llm_call_id"), // +
    staleReason: text("stale_reason"), // +
    createdBy: text("created_by"), // +
    createdAt: text("created_at").notNull(),
    version: version(),
  },
  (t) => [uniqueIndex("briefs_case_no_idx").on(t.caseId, t.versionNo)],
);

export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    briefId: text("brief_id").notNull(),
    actorId: text("actor_id").notNull(),
    briefHash: text("brief_hash").notNull(),
    audience: text("audience").notNull(),
    evidenceHash: text("evidence_hash").notNull().default(""), // +
    stale: bool("stale"),
    staleReason: text("stale_reason"), // +
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("approvals_brief_idx").on(t.briefId)],
);

export const releases = sqliteTable(
  "releases",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(), // +
    briefId: text("brief_id").notNull(),
    actorId: text("actor_id").notNull(),
    briefHash: text("brief_hash").notNull(),
    audience: text("audience").notNull().default("analyst"), // +
    releasedAt: text("released_at").notNull(),
  },
  (t) => [index("releases_case_idx").on(t.caseId)],
);

export const dependencies = sqliteTable(
  "dependencies",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(), // +
    dependentType: text("dependent_type", {
      enum: ["decision", "attestation", "approval", "finding", "brief"],
    }).notNull(),
    dependentId: text("dependent_id").notNull(),
    sourceType: text("source_type", {
      enum: ["turn", "claim", "context_fact", "policy_version", "document", "brief", "decision"],
    }).notNull(),
    sourceId: text("source_id").notNull(),
    sourceHash: text("source_hash").notNull(),
    sourceLabel: text("source_label").notNull().default(""), // + human label for the stale checklist ("T19")
  },
  (t) => [
    index("dependencies_dependent_idx").on(t.dependentType, t.dependentId),
    index("dependencies_case_idx").on(t.caseId),
  ],
);

// ── Infrastructure ──────────────────────────────────────────────────────────

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type", {
      enum: ["compile_policy", "analyze_transcript", "reevaluate_case", "draft_brief", "extract_doc_facts"],
    }).notNull(),
    payloadJson: text("payload_json").notNull(),
    status: text("status", { enum: ["queued", "running", "succeeded", "failed"] }).notNull(),
    stage: text("stage").notNull().default(""),
    progress: integer("progress").notNull().default(0), // 0–100
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    resultJson: text("result_json"), // +
    idempotencyKey: text("idempotency_key"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("jobs_idem_idx").on(t.idempotencyKey), index("jobs_status_idx").on(t.status, t.createdAt)],
);

export const llmCalls = sqliteTable(
  "llm_calls",
  {
    id: text("id").primaryKey(),
    stage: text("stage").notNull(),
    requestHash: text("request_hash").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    requestJson: text("request_json").notNull(),
    responseJson: text("response_json").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheCreationTokens: integer("cache_creation_tokens").notNull().default(0), // +
    stopReason: text("stop_reason"),
    latencyMs: integer("latency_ms").notNull().default(0),
    replayed: bool("replayed"),
    recordedAt: text("recorded_at"), // + when the replayed response was originally recorded
    refJson: text("ref_json").notNull().default("{}"), // + { caseId?, policyVersionId?, documentId? }
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("llm_calls_hash_idx").on(t.requestHash)],
);

export const processingIssues = sqliteTable(
  "processing_issues",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    runId: text("run_id"),
    severity: text("severity", { enum: ["blocking", "warning"] }).notNull(),
    code: text("code").notNull(),
    message: text("message").notNull(),
    refJson: text("ref_json").notNull().default("{}"),
    resolved: bool("resolved"),
    createdAt: text("created_at").notNull(), // +
  },
  (t) => [index("processing_issues_case_idx").on(t.caseId)],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    seq: integer("seq").notNull(),
    ts: text("ts").notNull(),
    actorId: text("actor_id").notNull(), // user id or "system"
    type: text("type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    caseId: text("case_id"), // + lets GET /api/audit?caseId= filter without parsing payloads
    payloadJson: text("payload_json").notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [uniqueIndex("audit_events_seq_idx").on(t.seq), index("audit_events_case_idx").on(t.caseId)],
);

export const idempotency = sqliteTable("idempotency", {
  key: text("key").primaryKey(),
  responseJson: text("response_json").notNull(), // { status, body }
  createdAt: text("created_at").notNull(),
});

export const reviewSessions = sqliteTable(
  "review_sessions",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id").notNull(),
    actorId: text("actor_id").notNull(),
    mode: text("mode", { enum: ["blink", "baseline"] }).notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    activeMs: integer("active_ms").notNull().default(0),
    lastActivityAt: text("last_activity_at").notNull(), // + drives the 2-minute idle pause (§16 phase 7)
    outcomeJson: text("outcome_json"), // + the baseline-mode decision form
  },
  (t) => [index("review_sessions_case_idx").on(t.caseId)],
);

/** + Stored output of `pnpm eval` so the metrics page can show it (§16 phase 7). */
export const evalRuns = sqliteTable("eval_runs", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  mode: text("mode").notNull(),
  resultJson: text("result_json").notNull(),
});
