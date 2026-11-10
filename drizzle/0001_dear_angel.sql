CREATE TABLE `call_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`call_id` text NOT NULL,
	`logical_key` text NOT NULL,
	`record_json` text NOT NULL,
	`monitor_states_json` text DEFAULT '[]' NOT NULL,
	`flagged` text NOT NULL,
	`rule_ids_json` text DEFAULT '[]' NOT NULL,
	`first_flagged_seq` integer,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `call_claims_call_idx` ON `call_claims` (`call_id`);--> statement-breakpoint
CREATE TABLE `call_outages` (
	`id` text PRIMARY KEY NOT NULL,
	`call_id` text NOT NULL,
	`stage` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`cause` text NOT NULL,
	`shown_to_banker` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `call_outages_call_idx` ON `call_outages` (`call_id`);--> statement-breakpoint
CREATE TABLE `call_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`call_id` text NOT NULL,
	`seq` integer NOT NULL,
	`speaker` text NOT NULL,
	`text` text NOT NULL,
	`text_hash` text NOT NULL,
	`speech_start_ms` integer,
	`speech_end_ms` integer NOT NULL,
	`speech_ended_at` text NOT NULL,
	`transcribed_at` text NOT NULL,
	`received_at` text NOT NULL,
	`read_ms` integer,
	`rules_ms` integer,
	`decided_at` text NOT NULL,
	`response_received_at` text,
	`shown_at` text,
	`read_status` text NOT NULL,
	`llm_call_id` text,
	`claims_json` text DEFAULT '[]' NOT NULL,
	`evaluations_json` text DEFAULT '[]' NOT NULL,
	`rejected_json` text DEFAULT '[]' NOT NULL,
	`pill` text NOT NULL,
	`pill_reason` text NOT NULL,
	`pill_rule_ids_json` text DEFAULT '[]' NOT NULL,
	`suppressed` integer DEFAULT false NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `call_turns_call_seq_idx` ON `call_turns` (`call_id`,`seq`);--> statement-breakpoint
CREATE TABLE `calls` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`started_by` text NOT NULL,
	`policy_version_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`last_amber_at` text,
	`transcript_version_id` text,
	`analysis_job_id` text,
	`reader_model` text NOT NULL,
	`reader_prompt_version` text NOT NULL,
	`hidden_count` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `calls_case_idx` ON `calls` (`case_id`);--> statement-breakpoint
CREATE TABLE `finding_passages` (
	`id` text PRIMARY KEY NOT NULL,
	`finding_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`start_char` integer NOT NULL,
	`end_char` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `finding_passages_finding_idx` ON `finding_passages` (`finding_id`);