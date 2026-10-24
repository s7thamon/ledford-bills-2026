-- Shape of the Laravel (flux) database after all its migrations ran.
DROP TABLE IF EXISTS bill_participants;
DROP TABLE IF EXISTS reimbursements;
DROP TABLE IF EXISTS bills;
DROP TABLE IF EXISTS recurring_bill_participants;
DROP TABLE IF EXISTS recurring_bills;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name varchar(255) NOT NULL,
  email varchar(255) NOT NULL UNIQUE,
  email_verified_at timestamp NULL,
  password varchar(255) NOT NULL,
  two_factor_secret text NULL,
  two_factor_recovery_codes text NULL,
  two_factor_confirmed_at timestamp NULL,
  remember_token varchar(100) NULL,
  created_at timestamp NULL,
  updated_at timestamp NULL
);

CREATE TABLE sessions (
  id varchar(255) NOT NULL PRIMARY KEY,
  user_id bigint unsigned NULL,
  payload longtext NOT NULL,
  last_activity int NOT NULL
);

CREATE TABLE recurring_bills (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_by bigint unsigned NOT NULL,
  type varchar(255) NOT NULL DEFAULT 'bill',
  other_user_id bigint unsigned NULL,
  name varchar(255) NOT NULL,
  amount_cents bigint unsigned NOT NULL,
  day_of_month tinyint unsigned NOT NULL,
  sort_order int unsigned NOT NULL DEFAULT 0,
  active tinyint(1) NOT NULL DEFAULT 1,
  created_at timestamp NULL,
  updated_at timestamp NULL
);

CREATE TABLE recurring_bill_participants (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  recurring_bill_id bigint unsigned NOT NULL,
  user_id bigint unsigned NOT NULL,
  amount_cents bigint unsigned NOT NULL,
  created_at timestamp NULL,
  updated_at timestamp NULL
);

CREATE TABLE bills (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  recurring_bill_id bigint unsigned NULL,
  created_by bigint unsigned NOT NULL,
  name varchar(255) NOT NULL,
  amount_cents bigint unsigned NOT NULL,
  added_on date NOT NULL,
  card_paid_at timestamp NULL,
  created_at timestamp NULL,
  updated_at timestamp NULL
);

CREATE TABLE bill_participants (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bill_id bigint unsigned NOT NULL,
  user_id bigint unsigned NOT NULL,
  amount_cents bigint unsigned NOT NULL,
  paid_at timestamp NULL,
  created_at timestamp NULL,
  updated_at timestamp NULL
);

CREATE TABLE reimbursements (
  id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
  recurring_bill_id bigint unsigned NULL,
  created_by bigint unsigned NOT NULL,
  other_user_id bigint unsigned NOT NULL,
  name varchar(255) NOT NULL,
  owed_cents bigint unsigned NOT NULL,
  notes text NULL,
  transfer_completed_at timestamp NULL,
  completed_at timestamp NULL,
  created_at timestamp NULL,
  updated_at timestamp NULL
);
