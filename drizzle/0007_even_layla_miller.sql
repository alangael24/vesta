CREATE TABLE `outfit_render_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`outfit_id` text NOT NULL,
	`quality` text DEFAULT 'low' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`error_code` text,
	`result_path` text,
	`createdAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updatedAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`outfit_id`) REFERENCES `outfits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outfit_render_jobs_owner_outfit_idx` ON `outfit_render_jobs` (`owner_id`,`outfit_id`,`createdAt`);--> statement-breakpoint
CREATE INDEX `outfit_render_jobs_status_idx` ON `outfit_render_jobs` (`status`,`updatedAt`);