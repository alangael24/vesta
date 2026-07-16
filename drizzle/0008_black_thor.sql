CREATE TABLE `avatar_generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`error_code` text,
	`avatar_version` text,
	`createdAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updatedAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `avatar_generation_jobs_owner_created_idx` ON `avatar_generation_jobs` (`owner_id`,`createdAt`);--> statement-breakpoint
CREATE INDEX `avatar_generation_jobs_status_idx` ON `avatar_generation_jobs` (`status`,`updatedAt`);