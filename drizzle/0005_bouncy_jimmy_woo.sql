ALTER TABLE `garments` ADD `source_type` text DEFAULT 'photos' NOT NULL;--> statement-breakpoint
ALTER TABLE `garments` ADD `source_url` text;