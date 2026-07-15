ALTER TABLE `garments` ADD `duplicate_of_id` text;--> statement-breakpoint
ALTER TABLE `garments` ADD `dedup_confidence` integer;--> statement-breakpoint
ALTER TABLE `garments` ADD `dedup_rationale` text;--> statement-breakpoint
ALTER TABLE `garments` ADD `reconstruction_model` text;--> statement-breakpoint
ALTER TABLE `garments` ADD `reconstruction_quality` text;--> statement-breakpoint
ALTER TABLE `garments` ADD `reconstruction_approved_at` text;--> statement-breakpoint
ALTER TABLE `garments` ADD `reconstructed_at` text;--> statement-breakpoint
ALTER TABLE `garments` ADD `cutout_width` integer;--> statement-breakpoint
ALTER TABLE `garments` ADD `cutout_height` integer;--> statement-breakpoint
ALTER TABLE `garments` ADD `transparent_pixel_ratio` integer;--> statement-breakpoint
ALTER TABLE `garments` ADD `qa_status` text;--> statement-breakpoint
ALTER TABLE `garments` ADD `qa_json` text;--> statement-breakpoint
CREATE INDEX `garments_duplicate_idx` ON `garments` (`owner_id`,`duplicate_of_id`);--> statement-breakpoint
ALTER TABLE `processing_jobs` ADD `garment_id` text;--> statement-breakpoint
CREATE INDEX `processing_jobs_garment_idx` ON `processing_jobs` (`garment_id`);