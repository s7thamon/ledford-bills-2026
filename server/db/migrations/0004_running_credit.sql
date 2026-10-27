CREATE TABLE `credit_uses` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`refund_id` bigint unsigned NOT NULL,
	`bill_id` bigint unsigned NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`amount_cents` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `credit_uses_id` PRIMARY KEY(`id`),
	CONSTRAINT `credit_uses_unique` UNIQUE(`refund_id`,`bill_id`,`user_id`)
);
--> statement-breakpoint
ALTER TABLE `credit_uses` ADD CONSTRAINT `credit_uses_refund_id_refunds_id_fk` FOREIGN KEY (`refund_id`) REFERENCES `refunds`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_uses` ADD CONSTRAINT `credit_uses_bill_id_bills_id_fk` FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `credit_uses` ADD CONSTRAINT `credit_uses_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `credit_uses_bill_idx` ON `credit_uses` (`bill_id`);--> statement-breakpoint
INSERT INTO `credit_uses` (`refund_id`, `bill_id`, `user_id`, `amount_cents`, `created_at`)
SELECT rs.`refund_id`, r.`applied_to_bill_id`, rs.`user_id`, rs.`amount_cents`, COALESCE(r.`applied_at`, now())
FROM `refund_shares` rs JOIN `refunds` r ON r.`id` = rs.`refund_id`
WHERE r.`applied_to_bill_id` IS NOT NULL AND rs.`amount_cents` > 0;--> statement-breakpoint
ALTER TABLE `refunds` DROP FOREIGN KEY `refunds_applied_to_bill_id_bills_id_fk`;--> statement-breakpoint
ALTER TABLE `refunds` DROP INDEX `refunds_applied_unique`;--> statement-breakpoint
ALTER TABLE `refunds` DROP COLUMN `applied_to_bill_id`;--> statement-breakpoint
ALTER TABLE `refunds` DROP COLUMN `applied_at`;--> statement-breakpoint
ALTER TABLE `bills` DROP FOREIGN KEY `bills_paid_with_card_of_users_id_fk`;--> statement-breakpoint
ALTER TABLE `bills` DROP COLUMN `paid_with_card_of`;
