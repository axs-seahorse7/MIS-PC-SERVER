-- ============================================================
-- MES / PCB MIS Database
-- Migration: 001_initial_schema
-- Generated from the existing pcb_mis schema.
--
-- IMPORTANT:
--   This migration creates the database structure only.
--   It does NOT contain production/application data.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- 01. box_items
CREATE TABLE `box_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `box_id` int NOT NULL,
  `serial_no` varchar(100) NOT NULL,
  `product_id` int NOT NULL,
  `packed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_box_serial` (`box_id`,`serial_no`),
  KEY `idx_box_items_serial` (`serial_no`),
  KEY `idx_box_items_product` (`product_id`),
  CONSTRAINT `fk_box_items_box` FOREIGN KEY (`box_id`) REFERENCES `boxes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_box_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 02. box_print_jobs
CREATE TABLE `box_print_jobs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `box_id` int NOT NULL,
  `printer_id` int NOT NULL,
  `barcode_data` varchar(255) NOT NULL,
  `status` enum('PENDING','PRINTING','PRINTED','FAILED') NOT NULL DEFAULT 'PENDING',
  `attempts` int NOT NULL DEFAULT '0',
  `error_message` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `printed_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_print_jobs_status` (`status`),
  KEY `idx_print_jobs_box` (`box_id`),
  KEY `idx_print_jobs_printer` (`printer_id`),
  CONSTRAINT `fk_box_print_jobs_box` FOREIGN KEY (`box_id`) REFERENCES `boxes` (`id`),
  CONSTRAINT `fk_box_print_jobs_printer` FOREIGN KEY (`printer_id`) REFERENCES `printers` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 03. boxes
CREATE TABLE `boxes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `box_code` varchar(100) NOT NULL,
  `product_id` int NOT NULL,
  `packaging_stage_id` int NOT NULL,
  `box_size` int NOT NULL,
  `actual_quantity` int DEFAULT '0',
  `status` enum('OPEN','PACKING','PACKED','FG_RECEIVED','DISPATCHED','HOLD','CANCELLED') NOT NULL DEFAULT 'OPEN',
  `barcode_data` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `packed_at` timestamp NULL DEFAULT NULL,
  `closed_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `box_code` (`box_code`),
  KEY `idx_boxes_product` (`product_id`),
  KEY `idx_boxes_stage` (`packaging_stage_id`),
  KEY `idx_boxes_status` (`status`),
  KEY `idx_boxes_created_at` (`created_at`),
  CONSTRAINT `fk_boxes_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  CONSTRAINT `fk_boxes_stage` FOREIGN KEY (`packaging_stage_id`) REFERENCES `stages` (`id`),
  CONSTRAINT `chk_box_actual_quantity` CHECK (((`actual_quantity` >= 0) and (`actual_quantity` <= `box_size`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 04. categories
CREATE TABLE `categories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `description` text,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 05. external_results
CREATE TABLE `external_results` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `source_id` int NOT NULL,
  `identifier` varchar(255) NOT NULL,
  `result` varchar(50) NOT NULL,
  `payload` json DEFAULT NULL,
  `received_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `source_id` (`source_id`),
  CONSTRAINT `external_results_ibfk_1` FOREIGN KEY (`source_id`) REFERENCES `external_sources` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 06. external_source_mappings
CREATE TABLE `external_source_mappings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `source_id` int NOT NULL,
  `product_id` int NOT NULL,
  `external_field` varchar(100) NOT NULL,
  `mapping_type` enum('IDENTIFIER','RESULT','ATTRIBUTE','IGNORE') NOT NULL,
  `product_field_id` int DEFAULT NULL,
  `attribute_name` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_mapping_source` (`source_id`),
  KEY `fk_mapping_product` (`product_id`),
  KEY `fk_mapping_product_field` (`product_field_id`),
  CONSTRAINT `fk_mapping_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mapping_product_field` FOREIGN KEY (`product_field_id`) REFERENCES `product_fields` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_mapping_source` FOREIGN KEY (`source_id`) REFERENCES `external_sources` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 07. external_sources
CREATE TABLE `external_sources` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 08. factories
CREATE TABLE `factories` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `code` varchar(50) NOT NULL,
  `address` text,
  `description` text,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 09. fct_results
CREATE TABLE `fct_results` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `line_code` varchar(50) NOT NULL,
  `mo_lot_no` varchar(100) NOT NULL,
  `rail` varchar(50) DEFAULT NULL,
  `sn_code` varchar(100) NOT NULL,
  `station_code` varchar(100) NOT NULL,
  `surface` varchar(20) DEFAULT NULL,
  `results` json NOT NULL,
  `status` enum('PASS','FAIL') DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sn_code` (`sn_code`),
  KEY `idx_mo_lot_no` (`mo_lot_no`),
  KEY `idx_station_code` (`station_code`),
  KEY `idx_line_code` (`line_code`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 10. ict_results
CREATE TABLE `ict_results` (
  `id` int NOT NULL AUTO_INCREMENT,
  `serial_no` varchar(100) NOT NULL,
  `program` varchar(255) DEFAULT NULL,
  `result` enum('PASS','FAIL') NOT NULL,
  `machine_name` varchar(100) NOT NULL,
  `imported_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `machine_code` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_serial_machine` (`serial_no`,`machine_name`)
) ENGINE=InnoDB AUTO_INCREMENT=143 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 11. item_field_values
CREATE TABLE `item_field_values` (
  `id` int NOT NULL AUTO_INCREMENT,
  `item_id` int NOT NULL,
  `product_field_id` int NOT NULL,
  `value` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_item_field` (`item_id`,`product_field_id`),
  KEY `fk_ifv_field` (`product_field_id`),
  CONSTRAINT `fk_ifv_field` FOREIGN KEY (`product_field_id`) REFERENCES `product_fields` (`id`),
  CONSTRAINT `fk_ifv_item` FOREIGN KEY (`item_id`) REFERENCES `items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 12. item_group_members
CREATE TABLE `item_group_members` (
  `id` int NOT NULL AUTO_INCREMENT,
  `group_id` int NOT NULL,
  `item_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `group_id` (`group_id`,`item_id`),
  KEY `item_id` (`item_id`),
  CONSTRAINT `item_group_members_ibfk_1` FOREIGN KEY (`group_id`) REFERENCES `item_groups` (`id`) ON DELETE CASCADE,
  CONSTRAINT `item_group_members_ibfk_2` FOREIGN KEY (`item_id`) REFERENCES `items` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 13. item_groups
CREATE TABLE `item_groups` (
  `id` int NOT NULL AUTO_INCREMENT,
  `group_code` varchar(50) NOT NULL,
  `product_id` int NOT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `group_code` (`group_code`),
  KEY `product_id` (`product_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `item_groups_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  CONSTRAINT `item_groups_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 14. items
CREATE TABLE `items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `product_id` int NOT NULL,
  `current_stage_id` int DEFAULT NULL,
  `status` enum('IN_PROGRESS','COMPLETED','HOLD','REJECTED') DEFAULT 'IN_PROGRESS',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_item_product` (`product_id`),
  KEY `fk_item_stage` (`current_stage_id`),
  CONSTRAINT `fk_item_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  CONSTRAINT `fk_item_stage` FOREIGN KEY (`current_stage_id`) REFERENCES `stages` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 15. packaging_config
CREATE TABLE `packaging_config` (
  `id` int NOT NULL AUTO_INCREMENT,
  `stage_id` int NOT NULL,
  `product_id` int NOT NULL,
  `box_size` int NOT NULL,
  `printer_id` int NOT NULL,
  `barcode_format` varchar(50) DEFAULT 'CODE128',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_packaging_product_stage` (`product_id`,`stage_id`),
  KEY `idx_packaging_config_stage` (`stage_id`),
  KEY `idx_packaging_config_product` (`product_id`),
  KEY `idx_packaging_config_printer` (`printer_id`),
  CONSTRAINT `fk_packaging_config_printer` FOREIGN KEY (`printer_id`) REFERENCES `printers` (`id`),
  CONSTRAINT `fk_packaging_config_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  CONSTRAINT `fk_packaging_config_stage` FOREIGN KEY (`stage_id`) REFERENCES `stages` (`id`),
  CONSTRAINT `chk_packaging_box_size` CHECK ((`box_size` > 0))
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 16. printers
CREATE TABLE `printers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `printer_type` enum('LABEL','THERMAL','LASER','NETWORK') NOT NULL DEFAULT 'LABEL',
  `ip_address` varchar(45) DEFAULT NULL,
  `port` int DEFAULT NULL,
  `printer_name` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_printer_name` (`name`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 17. product_fields
CREATE TABLE `product_fields` (
  `id` int NOT NULL AUTO_INCREMENT,
  `product_id` int NOT NULL,
  `field_name` varchar(100) NOT NULL,
  `field_type` varchar(50) DEFAULT 'TEXT',
  `is_required` tinyint(1) DEFAULT '0',
  `is_unique` tinyint(1) DEFAULT '0',
  `is_scannable` tinyint(1) DEFAULT '0',
  `display_order` int DEFAULT '1',
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `is_primary_identifier` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `product_id` (`product_id`),
  CONSTRAINT `product_fields_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 18. product_stage_flow
CREATE TABLE `product_stage_flow` (
  `id` int NOT NULL AUTO_INCREMENT,
  `product_id` int NOT NULL,
  `stage_id` int NOT NULL,
  `sequence_no` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `scan_mode` enum('SINGLE','GROUP_CREATE','GROUP_SCAN') DEFAULT 'SINGLE',
  `is_external_dependency` tinyint(1) NOT NULL DEFAULT '0',
  `external_source` varchar(255) DEFAULT NULL,
  `external_source_type` enum('LOCAL_FILE','API') DEFAULT NULL,
  `external_machine_type` varchar(20) DEFAULT NULL,
  `external_folder_path` varchar(500) DEFAULT NULL,
  `external_poll_interval_minutes` int DEFAULT NULL,
  `external_api_config` json DEFAULT NULL,
  `machine_code` varchar(30) DEFAULT NULL,
  `external_file_extensions` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_product_stage` (`product_id`,`stage_id`),
  UNIQUE KEY `uq_product_sequence` (`product_id`,`sequence_no`),
  KEY `fk_psf_stage` (`stage_id`),
  CONSTRAINT `fk_psf_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_psf_stage` FOREIGN KEY (`stage_id`) REFERENCES `stages` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 19. production
CREATE TABLE `production` (
  `id` int NOT NULL AUTO_INCREMENT,
  `serial_no` varchar(100) NOT NULL,
  `product_id` int NOT NULL,
  `erp_no` varchar(100) DEFAULT NULL,
  `factory_id` int NOT NULL,
  `line_id` int NOT NULL,
  `current_stage_id` int DEFAULT NULL,
  `current_sequence_no` int NOT NULL DEFAULT '0',
  `status` enum('CREATED','IN_PROGRESS','ON_HOLD','REWORK','REJECTED','COMPLETED','PACKED','DISPATCHED') NOT NULL DEFAULT 'CREATED',
  `completed_at` datetime DEFAULT NULL,
  `packed_at` datetime DEFAULT NULL,
  `dispatched_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `serial_no` (`serial_no`),
  KEY `fk_production_factory` (`factory_id`),
  KEY `fk_production_line` (`line_id`),
  KEY `fk_production_stage` (`current_stage_id`),
  CONSTRAINT `fk_production_factory` FOREIGN KEY (`factory_id`) REFERENCES `factories` (`id`),
  CONSTRAINT `fk_production_line` FOREIGN KEY (`line_id`) REFERENCES `production_lines` (`id`),
  CONSTRAINT `fk_production_stage` FOREIGN KEY (`current_stage_id`) REFERENCES `stages` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 20. production_lines
CREATE TABLE `production_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `factory_id` int NOT NULL,
  `name` varchar(100) NOT NULL,
  `code` varchar(50) DEFAULT NULL,
  `description` text,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `factory_id` (`factory_id`,`code`),
  CONSTRAINT `fk_line_factory` FOREIGN KEY (`factory_id`) REFERENCES `factories` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 21. production_targets
CREATE TABLE `production_targets` (
  `id` int NOT NULL AUTO_INCREMENT,
  `factory_id` int NOT NULL,
  `line_id` int NOT NULL,
  `product_id` int NOT NULL,
  `target_date` date NOT NULL,
  `target_quantity` int NOT NULL,
  `created_by` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_target` (`factory_id`,`line_id`,`product_id`,`target_date`),
  KEY `line_id` (`line_id`),
  KEY `product_id` (`product_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `production_targets_ibfk_1` FOREIGN KEY (`factory_id`) REFERENCES `factories` (`id`),
  CONSTRAINT `production_targets_ibfk_2` FOREIGN KEY (`line_id`) REFERENCES `production_lines` (`id`),
  CONSTRAINT `production_targets_ibfk_3` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  CONSTRAINT `production_targets_ibfk_4` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 22. products
CREATE TABLE `products` (
  `id` int NOT NULL AUTO_INCREMENT,
  `category_id` int NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text,
  `remarks` text,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `erp_no` varchar(100) DEFAULT NULL,
  `serial_no` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `category_id` (`category_id`),
  CONSTRAINT `products_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 23. scan_groups
CREATE TABLE `scan_groups` (
  `id` int NOT NULL AUTO_INCREMENT,
  `group_code` varchar(64) NOT NULL,
  `product_id` int NOT NULL,
  `factory_id` int NOT NULL,
  `line_id` int NOT NULL,
  `stage_id` int NOT NULL,
  `created_by` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `group_code` (`group_code`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 24. scan_history
CREATE TABLE `scan_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `factory_id` int NOT NULL,
  `line_id` int NOT NULL,
  `stage_id` int NOT NULL,
  `user_id` int NOT NULL,
  `scanned_value` varchar(255) NOT NULL,
  `scanned_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `status` enum('SUCCESS','REJECTED','SKIPPED_STAGE') DEFAULT 'SUCCESS',
  `remarks` text,
  `group_id` int DEFAULT NULL,
  `sequence_no` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `idx_scanned_value` (`scanned_value`),
  KEY `idx_item_stage` (`stage_id`),
  KEY `idx_scanned_at` (`scanned_at`),
  KEY `idx_factory` (`factory_id`),
  KEY `idx_line` (`line_id`),
  KEY `fk_scan_group` (`group_id`),
  CONSTRAINT `fk_scan_factory` FOREIGN KEY (`factory_id`) REFERENCES `factories` (`id`),
  CONSTRAINT `fk_scan_group` FOREIGN KEY (`group_id`) REFERENCES `scan_groups` (`id`),
  CONSTRAINT `fk_scan_line` FOREIGN KEY (`line_id`) REFERENCES `production_lines` (`id`),
  CONSTRAINT `scan_history_ibfk_2` FOREIGN KEY (`stage_id`) REFERENCES `stages` (`id`),
  CONSTRAINT `scan_history_ibfk_3` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 25. stage_scan_fields
CREATE TABLE `stage_scan_fields` (
  `id` int NOT NULL AUTO_INCREMENT,
  `product_stage_flow_id` int NOT NULL,
  `product_field_id` int NOT NULL,
  `is_required` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stage_field` (`product_stage_flow_id`,`product_field_id`),
  KEY `fk_ssf_field` (`product_field_id`),
  CONSTRAINT `fk_ssf_field` FOREIGN KEY (`product_field_id`) REFERENCES `product_fields` (`id`),
  CONSTRAINT `fk_ssf_flow` FOREIGN KEY (`product_stage_flow_id`) REFERENCES `product_stage_flow` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 26. stages
CREATE TABLE `stages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `category_id` int NOT NULL,
  `line_id` int DEFAULT NULL,
  `name` varchar(100) NOT NULL,
  `description` text,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `factory_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_stage_category_name` (`category_id`,`name`),
  KEY `fk_stage_line` (`line_id`),
  KEY `fk_stages_factory` (`factory_id`),
  CONSTRAINT `fk_stage_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`),
  CONSTRAINT `fk_stage_line` FOREIGN KEY (`line_id`) REFERENCES `production_lines` (`id`),
  CONSTRAINT `fk_stages_factory` FOREIGN KEY (`factory_id`) REFERENCES `factories` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 27. users
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(100) NOT NULL,
  `password` varchar(255) NOT NULL,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `role` enum('SYSTEM_ADMIN','ADMIN','OPERATOR') DEFAULT 'OPERATOR',
  `factory_id` int DEFAULT NULL,
  `line_id` int DEFAULT NULL,
  `stage_id` int DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  KEY `fk_user_stage` (`stage_id`),
  KEY `fk_user_factory` (`factory_id`),
  KEY `fk_user_line` (`line_id`),
  CONSTRAINT `fk_user_factory` FOREIGN KEY (`factory_id`) REFERENCES `factories` (`id`),
  CONSTRAINT `fk_user_line` FOREIGN KEY (`line_id`) REFERENCES `production_lines` (`id`),
  CONSTRAINT `fk_user_stage` FOREIGN KEY (`stage_id`) REFERENCES `stages` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS = 1;
