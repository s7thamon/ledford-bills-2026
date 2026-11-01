CREATE TABLE `held_bills` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`created_by` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`amount_cents` bigint unsigned NOT NULL,
	`add_on` date NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `held_bills_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `held_bills` ADD CONSTRAINT `held_bills_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `held_bills_add_on_idx` ON `held_bills` (`add_on`);