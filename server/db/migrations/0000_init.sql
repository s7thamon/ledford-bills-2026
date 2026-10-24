CREATE TABLE `auth_tokens` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`type` varchar(20) NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`meta` varchar(255),
	`attempts` int NOT NULL DEFAULT 0,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auth_tokens_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bill_participants` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`bill_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`amount_cents` bigint unsigned NOT NULL,
	`paid_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bill_participants_id` PRIMARY KEY(`id`),
	CONSTRAINT `bill_participants_unique` UNIQUE(`bill_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `bills` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`recurring_bill_id` bigint unsigned,
	`created_by` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`amount_cents` bigint unsigned NOT NULL,
	`added_on` date NOT NULL,
	`card_paid_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bills_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `recurring_bill_participants` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`recurring_bill_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`amount_cents` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recurring_bill_participants_id` PRIMARY KEY(`id`),
	CONSTRAINT `recurring_bill_participants_unique` UNIQUE(`recurring_bill_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `recurring_bills` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`created_by` bigint unsigned NOT NULL,
	`type` varchar(20) NOT NULL DEFAULT 'bill',
	`other_user_id` bigint unsigned,
	`name` varchar(255) NOT NULL,
	`amount_cents` bigint unsigned NOT NULL,
	`day_of_month` tinyint unsigned NOT NULL,
	`sort_order` int unsigned NOT NULL DEFAULT 0,
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `recurring_bills_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reimbursements` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`recurring_bill_id` bigint unsigned,
	`created_by` bigint unsigned NOT NULL,
	`other_user_id` bigint unsigned NOT NULL,
	`name` varchar(255) NOT NULL,
	`owed_cents` bigint unsigned NOT NULL,
	`notes` text,
	`transfer_completed_at` timestamp,
	`completed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reimbursements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trusted_devices` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`token_hash` varchar(64) NOT NULL,
	`user_agent` varchar(255),
	`last_used_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `trusted_devices_id` PRIMARY KEY(`id`),
	CONSTRAINT `trusted_devices_token_hash_unique` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password` varchar(255) NOT NULL,
	`email_verified_at` timestamp,
	`is_card_owner` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_participants` ADD CONSTRAINT `bill_participants_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bill_participants` ADD CONSTRAINT `bill_participants_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bills` ADD CONSTRAINT `bills_recurring_bill_id_recurring_bills_id_fk` FOREIGN KEY (`recurring_bill_id`) REFERENCES `recurring_bills`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `bills` ADD CONSTRAINT `bills_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recurring_bill_participants` ADD CONSTRAINT `recurring_bill_participants_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recurring_bill_participants` ADD CONSTRAINT `rbp_recurring_bill_id_fk` FOREIGN KEY (`recurring_bill_id`) REFERENCES `recurring_bills`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recurring_bills` ADD CONSTRAINT `recurring_bills_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recurring_bills` ADD CONSTRAINT `recurring_bills_other_user_id_users_id_fk` FOREIGN KEY (`other_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reimbursements` ADD CONSTRAINT `reimbursements_recurring_bill_id_recurring_bills_id_fk` FOREIGN KEY (`recurring_bill_id`) REFERENCES `recurring_bills`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reimbursements` ADD CONSTRAINT `reimbursements_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reimbursements` ADD CONSTRAINT `reimbursements_other_user_id_users_id_fk` FOREIGN KEY (`other_user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trusted_devices` ADD CONSTRAINT `trusted_devices_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `auth_tokens_user_type_idx` ON `auth_tokens` (`user_id`,`type`);--> statement-breakpoint
CREATE INDEX `bills_added_on_idx` ON `bills` (`added_on`);--> statement-breakpoint
CREATE INDEX `bills_recurring_added_idx` ON `bills` (`recurring_bill_id`,`added_on`);--> statement-breakpoint
CREATE INDEX `recurring_bills_day_sort_idx` ON `recurring_bills` (`day_of_month`,`sort_order`);--> statement-breakpoint
CREATE INDEX `reimbursements_completed_idx` ON `reimbursements` (`completed_at`);--> statement-breakpoint
CREATE INDEX `reimbursements_recurring_created_idx` ON `reimbursements` (`recurring_bill_id`,`created_at`);