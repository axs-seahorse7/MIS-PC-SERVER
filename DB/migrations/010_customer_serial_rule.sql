-- ============================================================
-- 010_customer_serial_rule.sql
--
-- Customer QR format:
--   PartCode + YY + WEEK + 5-digit Serial
--
-- Example:
--   RD12345 + 26 + 36 + 00001
--   = RD12345263600001
-- ============================================================


-- ============================================================
-- 1. Customer Serial Rules
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_serial_rules (
  id INT NOT NULL AUTO_INCREMENT,

  customer_name VARCHAR(150) NOT NULL,
  product_id INT NOT NULL,
  part_code VARCHAR(100) NOT NULL,

  serial_width INT NOT NULL DEFAULT 5,

  current_year SMALLINT NOT NULL,
  current_week TINYINT NOT NULL,

  next_serial INT NOT NULL DEFAULT 1,

  is_active TINYINT(1) NOT NULL DEFAULT 1,

  created_by INT DEFAULT NULL,

  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,

  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  UNIQUE KEY uq_customer_serial_rule_product (product_id),

  KEY idx_customer_serial_rule_active (is_active),

  KEY idx_customer_serial_rule_period (
    product_id,
    current_year,
    current_week
  )

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;


-- ============================================================
-- 2. Add customer_qr_code if it does not already exist
-- ============================================================

SET @column_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'production_order_items'
    AND COLUMN_NAME = 'customer_qr_code'
);

SET @sql = IF(
  @column_exists = 0,
  'ALTER TABLE production_order_items ADD COLUMN customer_qr_code VARCHAR(255) NULL AFTER serial_no',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ============================================================
-- 3. Add unique Customer QR index if it does not exist
-- ============================================================

SET @unique_index_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'production_order_items'
    AND INDEX_NAME = 'uq_production_order_item_customer_qr'
);

SET @sql = IF(
  @unique_index_exists = 0,
  'ALTER TABLE production_order_items ADD UNIQUE KEY uq_production_order_item_customer_qr (customer_qr_code)',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ============================================================
-- 4. Customer Binding Customer QR
--
-- Existing database has:
--
--   idx_customer_binding_customer_qr
--   NON-UNIQUE
--
-- Replace it with:
--
--   uq_customer_binding_customer
--   UNIQUE
-- ============================================================

SET @old_index_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customer_bindings'
    AND INDEX_NAME = 'idx_customer_binding_customer_qr'
);

SET @sql = IF(
  @old_index_exists = 1,
  'ALTER TABLE customer_bindings DROP INDEX idx_customer_binding_customer_qr',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ============================================================
-- 5. Add unique Customer QR binding index
-- ============================================================

SET @binding_unique_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customer_bindings'
    AND INDEX_NAME = 'uq_customer_binding_customer'
);

SET @sql = IF(
  @binding_unique_exists = 0,
  'ALTER TABLE customer_bindings ADD UNIQUE KEY uq_customer_binding_customer (customer_qr)',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;