CREATE TABLE `scheduled_outfits` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`outfit_id` text NOT NULL,
	`scheduled_date` text NOT NULL,
	`note` text,
	`createdAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updatedAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`outfit_id`) REFERENCES `outfits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_outfits_owner_outfit_date_unique` ON `scheduled_outfits` (`owner_id`,`outfit_id`,`scheduled_date`);--> statement-breakpoint
CREATE INDEX `scheduled_outfits_owner_date_idx` ON `scheduled_outfits` (`owner_id`,`scheduled_date`);