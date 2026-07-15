CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`token_hash` text NOT NULL,
	`createdAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text,
	`revoked_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token_hash_unique` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE INDEX `devices_owner_idx` ON `devices` (`owner_id`);--> statement-breakpoint
CREATE TABLE `garment_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`garment_id` text NOT NULL,
	`photo_id` text NOT NULL,
	`bbox_x` integer NOT NULL,
	`bbox_y` integer NOT NULL,
	`bbox_width` integer NOT NULL,
	`bbox_height` integer NOT NULL,
	`confidence` integer,
	`createdAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`garment_id`) REFERENCES `garments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`photo_id`) REFERENCES `source_photos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `garment_evidence_garment_idx` ON `garment_evidence` (`garment_id`);--> statement-breakpoint
CREATE TABLE `garments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`batch_id` text,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`type` text NOT NULL,
	`color` text,
	`material` text,
	`description` text,
	`confidence` integer,
	`fingerprint` text,
	`cutout_key` text,
	`preview_key` text,
	`status` text DEFAULT 'candidate' NOT NULL,
	`createdAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updatedAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `garments_owner_status_idx` ON `garments` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `garments_fingerprint_idx` ON `garments` (`owner_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`device_id` text,
	`photo_count` integer NOT NULL,
	`total_bytes` integer NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`originals_policy` text DEFAULT 'retain_private' NOT NULL,
	`createdAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updatedAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `import_batches_owner_created_idx` ON `import_batches` (`owner_id`,`createdAt`);--> statement-breakpoint
CREATE TABLE `outfit_items` (
	`outfit_id` text NOT NULL,
	`garment_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`outfit_id`, `garment_id`),
	FOREIGN KEY (`outfit_id`) REFERENCES `outfits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`garment_id`) REFERENCES `garments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `outfits` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`occasion` text NOT NULL,
	`rationale` text NOT NULL,
	`render_key` text,
	`status` text DEFAULT 'suggested' NOT NULL,
	`createdAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updatedAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outfits_owner_created_idx` ON `outfits` (`owner_id`,`createdAt`);--> statement-breakpoint
CREATE TABLE `pairing_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`createdAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`consumed_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pairing_code_hash_unique` ON `pairing_codes` (`code_hash`);--> statement-breakpoint
CREATE TABLE `processing_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`createdAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `processing_jobs_batch_status_idx` ON `processing_jobs` (`batch_id`,`status`);--> statement-breakpoint
CREATE TABLE `source_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`sha256` text,
	`status` text DEFAULT 'awaiting_upload' NOT NULL,
	`createdAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`uploaded_at` text,
	`deleted_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_photos_batch_idx` ON `source_photos` (`batch_id`);--> statement-breakpoint
CREATE INDEX `source_photos_owner_status_idx` ON `source_photos` (`owner_id`,`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`createdAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updatedAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);