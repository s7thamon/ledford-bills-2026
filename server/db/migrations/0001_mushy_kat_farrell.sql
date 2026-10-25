CREATE TABLE `refund_shares` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`refund_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`amount_cents` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `refund_shares_id` PRIMARY KEY(`id`),
	CONSTRAINT `refund_shares_unique` UNIQUE(`refund_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`bill_id` bigint unsigned NOT NULL,
	`amount_cents` bigint unsigned NOT NULL,
	`refunded_on` date NOT NULL,
	`created_by` bigint unsigned NOT NULL,
	`applied_to_bill_id` bigint unsigned,
	`applied_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `refunds_id` PRIMARY KEY(`id`),
	CONSTRAINT `refunds_applied_unique` UNIQUE(`applied_to_bill_id`)
);
--> statement-breakpoint
ALTER TABLE `bills` ADD `paid_with_card_of` bigint unsigned;--> statement-breakpoint
ALTER TABLE `refund_shares` ADD CONSTRAINT `refund_shares_refund_id_refunds_id_fk` FOREIGN KEY (`refund_id`) REFERENCES `refunds`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refund_shares` ADD CONSTRAINT `refund_shares_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_applied_to_bill_id_bills_id_fk` FOREIGN KEY (`applied_to_bill_id`) REFERENCES `bills`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `refunds_bill_idx` ON `refunds` (`bill_id`);--> statement-breakpoint
ALTER TABLE `bills` ADD CONSTRAINT `bills_paid_with_card_of_users_id_fk` FOREIGN KEY (`paid_with_card_of`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;