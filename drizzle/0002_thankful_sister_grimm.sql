ALTER TABLE `releases` ADD `transcript_version_id` text;--> statement-breakpoint
ALTER TABLE `releases` ADD `redacted_transcript_json` text;--> statement-breakpoint
ALTER TABLE `releases` ADD `redacted_transcript_hash` text;--> statement-breakpoint
ALTER TABLE `releases` ADD `hidden_passages` integer;