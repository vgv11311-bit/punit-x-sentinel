-- Run only after a verified backup, with the application temporarily offline.
CREATE TABLE `customers` (
 `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
 `name` varchar(255) NOT NULL,
 `enabled` tinyint(1) NOT NULL DEFAULT 1,
 `legacy_report_brand` tinyint(1) NOT NULL DEFAULT 0,
 `expires_on` date DEFAULT NULL,
 `created_at` timestamp NULL DEFAULT NULL,
 `updated_at` timestamp NULL DEFAULT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO `customers` (`name`,`enabled`,`legacy_report_brand`,`created_at`,`updated_at`) VALUES ('Existing customer',1,1,NOW(),NOW());
SET @sentinel_legacy_customer=LAST_INSERT_ID();
ALTER TABLE `users` ADD `customer_id` bigint unsigned DEFAULT NULL, ADD INDEX `users_customer_id_index` (`customer_id`);
UPDATE `users` SET `customer_id`=@sentinel_legacy_customer;
ALTER TABLE `custom_fields` ADD `customer_id` bigint unsigned DEFAULT NULL, ADD INDEX `custom_fields_customer_id_index` (`customer_id`);
UPDATE `custom_fields` SET `customer_id`=@sentinel_legacy_customer;
ALTER TABLE `weighments` ADD `customer_id` bigint unsigned DEFAULT NULL, ADD INDEX `weighments_customer_id_index` (`customer_id`);
UPDATE `weighments` SET `customer_id`=@sentinel_legacy_customer;
ALTER TABLE `custom_fields` DROP INDEX `custom_fields_slug_unique`, ADD UNIQUE `custom_fields_customer_id_slug_unique` (`customer_id`,`slug`);
ALTER TABLE `weighments` DROP INDEX `weighments_weighment_no_unique`, DROP INDEX `weighments_request_id_unique`, ADD UNIQUE `weighments_customer_id_weighment_no_unique` (`customer_id`,`weighment_no`), ADD UNIQUE `weighments_customer_id_request_id_unique` (`customer_id`,`request_id`);
CREATE TABLE `customer_settings` (
 `id` bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
 `customer_id` bigint unsigned NOT NULL,
 `key` varchar(255) NOT NULL,
 `value` text DEFAULT NULL,
 `created_at` timestamp NULL DEFAULT NULL,
 `updated_at` timestamp NULL DEFAULT NULL,
 KEY `customer_settings_customer_id_index` (`customer_id`),
 UNIQUE KEY `customer_settings_customer_id_key_unique` (`customer_id`,`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO `customer_settings` (`customer_id`,`key`,`value`,`created_at`,`updated_at`) SELECT @sentinel_legacy_customer,`key`,`value`,NOW(),NOW() FROM `settings`;
INSERT INTO `migrations` (`migration`,`batch`) SELECT '2026_11_16_000005_add_customer_isolation',COALESCE(MAX(`batch`),0)+1 FROM `migrations`;
