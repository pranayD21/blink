CREATE TABLE `analysis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`run_no` integer NOT NULL,
	`transcript_version_id` text NOT NULL,
	`packet_id` text NOT NULL,
	`policy_version_id` text,
	`document_set_id` text,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`source` text DEFAULT 'ai' NOT NULL,
	`status` text NOT NULL,
	`stage` text DEFAULT '' NOT NULL,
	`error` text,
	`report_json` text,
	`call_summary` text,
	`llm_call_id` text,
	`started_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `analysis_runs_case_idx` ON `analysis_runs` (`case_id`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`brief_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`brief_hash` text NOT NULL,
	`audience` text NOT NULL,
	`evidence_hash` text DEFAULT '' NOT NULL,
	`stale` integer DEFAULT false NOT NULL,
	`stale_reason` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `approvals_brief_idx` ON `approvals` (`brief_id`);--> statement-breakpoint
CREATE TABLE `attestations` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`transcript_version_id` text NOT NULL,
	`kind` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`stale` integer DEFAULT false NOT NULL,
	`stale_reason` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attestations_case_idx` ON `attestations` (`case_id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`seq` integer NOT NULL,
	`ts` text NOT NULL,
	`actor_id` text NOT NULL,
	`type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`case_id` text,
	`payload_json` text NOT NULL,
	`prev_hash` text NOT NULL,
	`hash` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_events_seq_idx` ON `audit_events` (`seq`);--> statement-breakpoint
CREATE INDEX `audit_events_case_idx` ON `audit_events` (`case_id`);--> statement-breakpoint
CREATE TABLE `briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`status` text NOT NULL,
	`body_md` text NOT NULL,
	`sentences_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`audience` text NOT NULL,
	`draft_source` text DEFAULT 'ai' NOT NULL,
	`issues_json` text DEFAULT '[]' NOT NULL,
	`withheld_count` integer DEFAULT 0 NOT NULL,
	`eligible_count` integer DEFAULT 0 NOT NULL,
	`llm_call_id` text,
	`stale_reason` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `briefs_case_no_idx` ON `briefs` (`case_id`,`version_no`);--> statement-breakpoint
CREATE TABLE `cases` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`issuer` text NOT NULL,
	`ticker` text NOT NULL,
	`status` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`active_policy_version_id` text,
	`document_set_id` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `claim_links` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`linked_claim_id` text,
	`linked_logical_key` text NOT NULL,
	`kind` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `claim_links_claim_idx` ON `claim_links` (`claim_id`);--> statement-breakpoint
CREATE TABLE `claim_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`quote` text NOT NULL,
	`start_char` integer NOT NULL,
	`end_char` integer NOT NULL,
	`role` text NOT NULL,
	`supports_fields_json` text DEFAULT '[]' NOT NULL,
	`normalized` integer DEFAULT false NOT NULL,
	`turn_text_hash` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `claim_quotes_claim_idx` ON `claim_quotes` (`claim_id`);--> statement-breakpoint
CREATE INDEX `claim_quotes_turn_idx` ON `claim_quotes` (`turn_id`);--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`run_id` text NOT NULL,
	`logical_key` text NOT NULL,
	`version_no` integer NOT NULL,
	`superseded_by` text,
	`status` text NOT NULL,
	`fields_json` text NOT NULL,
	`asserted_json` text NOT NULL,
	`verified_json` text,
	`meta_json` text DEFAULT '{}' NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `claims_case_key_idx` ON `claims` (`case_id`,`logical_key`);--> statement-breakpoint
CREATE TABLE `compile_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`policy_version_id` text NOT NULL,
	`stage` text NOT NULL,
	`attempt_no` integer NOT NULL,
	`input_hash` text NOT NULL,
	`output_json` text,
	`issues_json` text DEFAULT '[]' NOT NULL,
	`llm_call_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `compile_attempts_pv_idx` ON `compile_attempts` (`policy_version_id`);--> statement-breakpoint
CREATE TABLE `context_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`key` text NOT NULL,
	`claim_logical_key` text,
	`value_json` text NOT NULL,
	`evidence_state` text NOT NULL,
	`source` text NOT NULL,
	`source_ref` text,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`superseded_by` text
);
--> statement-breakpoint
CREATE INDEX `context_facts_case_key_idx` ON `context_facts` (`case_id`,`key`);--> statement-breakpoint
CREATE TABLE `decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`finding_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`kind` text NOT NULL,
	`outcome` text,
	`rationale` text NOT NULL,
	`evidence_hash` text NOT NULL,
	`stale` integer DEFAULT false NOT NULL,
	`stale_reason` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `decisions_finding_idx` ON `decisions` (`finding_id`);--> statement-breakpoint
CREATE TABLE `dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`dependent_type` text NOT NULL,
	`dependent_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`source_hash` text NOT NULL,
	`source_label` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dependencies_dependent_idx` ON `dependencies` (`dependent_type`,`dependent_id`);--> statement-breakpoint
CREATE INDEX `dependencies_case_idx` ON `dependencies` (`case_id`);--> statement-breakpoint
CREATE TABLE `document_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`document_ids_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source_type` text NOT NULL,
	`issuer` text NOT NULL,
	`related_issuers_json` text DEFAULT '[]' NOT NULL,
	`published_at` text NOT NULL,
	`ingested_at` text NOT NULL,
	`url_label` text NOT NULL,
	`body` text NOT NULL,
	`body_hash` text NOT NULL,
	`facts_json` text DEFAULT '[]' NOT NULL,
	`facts_status` text DEFAULT 'pending' NOT NULL,
	`facts_call_id` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `eval_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`mode` text NOT NULL,
	`result_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `experts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`current_employer` text DEFAULT '' NOT NULL,
	`current_title` text DEFAULT '' NOT NULL,
	`employment_json` text DEFAULT '[]' NOT NULL,
	`network` text DEFAULT '' NOT NULL,
	`network_attestation_json` text DEFAULT '{}' NOT NULL,
	`content_hash` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`claim_logical_key` text,
	`origin` text NOT NULL,
	`monitor_instance_id` text,
	`title` text NOT NULL,
	`severity` text NOT NULL,
	`state` text NOT NULL,
	`reason_codes_json` text DEFAULT '[]' NOT NULL,
	`explanation` text DEFAULT '' NOT NULL,
	`missing_context_json` text DEFAULT '[]' NOT NULL,
	`dedupe_key` text NOT NULL,
	`seq_no` integer NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `findings_dedupe_idx` ON `findings` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `findings_case_idx` ON `findings` (`case_id`);--> statement-breakpoint
CREATE TABLE `idempotency` (
	`key` text PRIMARY KEY NOT NULL,
	`response_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`stage` text DEFAULT '' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`result_json` text,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_idem_idx` ON `jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `llm_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`stage` text NOT NULL,
	`request_hash` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`request_json` text NOT NULL,
	`response_json` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_creation_tokens` integer DEFAULT 0 NOT NULL,
	`stop_reason` text,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`replayed` integer DEFAULT false NOT NULL,
	`recorded_at` text,
	`ref_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_calls_hash_idx` ON `llm_calls` (`request_hash`);--> statement-breakpoint
CREATE TABLE `monitor_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`seq` integer NOT NULL,
	`event_type` text NOT NULL,
	`event_id` text NOT NULL,
	`prev_state` text NOT NULL,
	`next_state` text NOT NULL,
	`transition_id` text,
	`result` text NOT NULL,
	`turn_label` text,
	`conflict_flag` integer DEFAULT false NOT NULL,
	`guard_trace_json` text NOT NULL,
	`effects_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monitor_evaluations_seq_idx` ON `monitor_evaluations` (`instance_id`,`seq`);--> statement-breakpoint
CREATE TABLE `monitor_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`claim_logical_key` text NOT NULL,
	`policy_version_id` text NOT NULL,
	`monitor_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`state` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monitor_instances_key_idx` ON `monitor_instances` (`case_id`,`claim_logical_key`,`policy_version_id`,`monitor_id`);--> statement-breakpoint
CREATE TABLE `packets` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`research_questions_json` text NOT NULL,
	`aliases_json` text DEFAULT '[]' NOT NULL,
	`issuer_fiscal_json` text NOT NULL,
	`call_date` text NOT NULL,
	`expert_id` text NOT NULL,
	`analyst_notes` text DEFAULT '' NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `packets_case_idx` ON `packets` (`case_id`);--> statement-breakpoint
CREATE TABLE `policy_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`text` text NOT NULL,
	`text_hash` text NOT NULL,
	`required_paragraphs_json` text DEFAULT '[]' NOT NULL,
	`scenarios_json` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `policy_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`policy_source_id` text NOT NULL,
	`label` text NOT NULL,
	`status` text NOT NULL,
	`compile_source` text DEFAULT 'ai' NOT NULL,
	`inventory_json` text,
	`rules_json` text,
	`monitors_json` text,
	`validation_json` text,
	`scenario_report_json` text,
	`preview_md` text,
	`bundle_hash` text,
	`approved_by` text,
	`approved_at` text,
	`activated_at` text,
	`superseded_at` text,
	`created_at` text NOT NULL,
	`compile_job_id` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `predicate_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`claim_id` text NOT NULL,
	`predicate` text NOT NULL,
	`params_json` text DEFAULT '{}' NOT NULL,
	`state` text NOT NULL,
	`evidence_refs_json` text DEFAULT '[]' NOT NULL,
	`explanation` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `predicate_assessments_claim_idx` ON `predicate_assessments` (`claim_id`);--> statement-breakpoint
CREATE TABLE `processing_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`run_id` text,
	`severity` text NOT NULL,
	`code` text NOT NULL,
	`message` text NOT NULL,
	`ref_json` text DEFAULT '{}' NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `processing_issues_case_idx` ON `processing_issues` (`case_id`);--> statement-breakpoint
CREATE TABLE `releases` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`brief_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`brief_hash` text NOT NULL,
	`audience` text DEFAULT 'analyst' NOT NULL,
	`released_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `releases_case_idx` ON `releases` (`case_id`);--> statement-breakpoint
CREATE TABLE `review_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`mode` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`active_ms` integer DEFAULT 0 NOT NULL,
	`last_activity_at` text NOT NULL,
	`outcome_json` text
);
--> statement-breakpoint
CREATE INDEX `review_sessions_case_idx` ON `review_sessions` (`case_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`finding_id` text NOT NULL,
	`monitor_instance_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`question` text DEFAULT '' NOT NULL,
	`answer` text,
	`assigned_role` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`meta_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	`closed_at` text,
	`closed_by` text,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_dedupe_idx` ON `tasks` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `tasks_finding_idx` ON `tasks` (`finding_id`);--> statement-breakpoint
CREATE TABLE `transcript_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`source_label` text NOT NULL,
	`raw_text` text NOT NULL,
	`content_hash` text NOT NULL,
	`supersedes_id` text,
	`created_by` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transcript_versions_case_no_idx` ON `transcript_versions` (`case_id`,`version_no`);--> statement-breakpoint
CREATE TABLE `turn_lineage` (
	`id` text PRIMARY KEY NOT NULL,
	`transcript_version_id` text NOT NULL,
	`new_turn_id` text,
	`old_turn_id` text,
	`change` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `turn_lineage_old_idx` ON `turn_lineage` (`old_turn_id`);--> statement-breakpoint
CREATE INDEX `turn_lineage_new_idx` ON `turn_lineage` (`new_turn_id`);--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY NOT NULL,
	`transcript_version_id` text NOT NULL,
	`idx` integer NOT NULL,
	`label` text NOT NULL,
	`speaker` text NOT NULL,
	`speaker_name` text DEFAULT '' NOT NULL,
	`timestamp` text,
	`start_char` integer NOT NULL,
	`end_char` integer NOT NULL,
	`text` text NOT NULL,
	`text_hash` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `turns_tv_idx` ON `turns` (`transcript_version_id`,`idx`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL
);
