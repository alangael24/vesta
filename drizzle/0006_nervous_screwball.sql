CREATE TABLE `subscription_entitlements` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`original_transaction_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`environment` text NOT NULL,
	`purchased_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text NOT NULL,
	`verified_at` text NOT NULL,
	`updatedAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_entitlements_original_transaction_unique` ON `subscription_entitlements` (`original_transaction_id`);--> statement-breakpoint
CREATE INDEX `subscription_entitlements_status_expiry_idx` ON `subscription_entitlements` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `subscription_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`original_transaction_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`createdAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updatedAt` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_usage_owner_idempotency_unique` ON `subscription_usage` (`owner_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `subscription_usage_owner_period_kind_idx` ON `subscription_usage` (`owner_id`,`period_start`,`kind`,`status`);