-- ============================================================
-- 011_customer_qr_buckets.sql
--
-- Customer QR architecture:
--
-- customer_serial_rules
--        ↓
-- customer_qr_buckets
--        ↓
-- customer_qr_codes
--
-- QR format:
-- PartCode + YY + WEEK + 5-digit Serial
--
-- Example:
-- 2040 + 26 + 36 + 00001
-- = 2040263600001
-- ============================================================


-- ============================================================
-- 1. Customer QR Buckets
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_qr_buckets (
  id INT NOT NULL AUTO_INCREMENT,

  rule_id INT NOT NULL,

  customer_name VARCHAR(150) NOT NULL,
  product_id INT NOT NULL,
  part_code VARCHAR(100) NOT NULL,

  year SMALLINT NOT NULL,
  week TINYINT NOT NULL,

  start_serial INT NOT NULL DEFAULT 1,
  end_serial INT NOT NULL DEFAULT 99999,
  next_serial INT NOT NULL DEFAULT 1,

  generated_qty INT NOT NULL DEFAULT 0,

  status ENUM(
    'ACTIVE',
    'COMPLETED',
    'CLOSED'
  ) NOT NULL DEFAULT 'ACTIVE',

  created_by INT DEFAULT NULL,

  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  UNIQUE KEY uq_customer_qr_bucket_rule_period (
    rule_id,
    year,
    week
  ),

  KEY idx_customer_qr_bucket_product (
    product_id
  ),

  KEY idx_customer_qr_bucket_status (
    status
  )

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;


-- ============================================================
-- 2. Individual Customer QR Inventory
-- ============================================================

CREATE TABLE IF NOT EXISTS customer_qr_codes (
  id BIGINT NOT NULL AUTO_INCREMENT,

  bucket_id INT NOT NULL,

  serial_no INT NOT NULL,

  qr_code VARCHAR(255) NOT NULL,

  status ENUM(
    'GENERATED',
    'PRINTED',
    'BOUND',
    'CANCELLED'
  ) NOT NULL DEFAULT 'GENERATED',

  printed_at DATETIME NULL,
  bound_at DATETIME NULL,

  created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  UNIQUE KEY uq_customer_qr_code (
    qr_code
  ),

  UNIQUE KEY uq_customer_qr_bucket_serial (
    bucket_id,
    serial_no
  ),

  KEY idx_customer_qr_code_bucket (
    bucket_id
  ),

  KEY idx_customer_qr_code_status (
    status
  )

) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;