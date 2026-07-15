ALTER TABLE `import_batches` ADD `processing_mode` text;--> statement-breakpoint
ALTER TABLE `import_batches` ADD `processing_approved_at` text;--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `model` text;--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `result_json` text;--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `input_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `output_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `updatedAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL;--> statement-breakpoint
ALTER TABLE `source_photos` ADD `normalized_key` text;