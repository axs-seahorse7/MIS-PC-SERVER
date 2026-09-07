-- ============================================================
-- Migration 018
-- Convert production_serial_rules from
-- product + line based → product based
-- ============================================================

-- 1. Create the new product-only unique constraint first.
-- This provides a dedicated index for product_id before the
-- old composite unique constraint is removed.
ALTER TABLE production_serial_rules
ADD CONSTRAINT uq_production_serial_rules_product
UNIQUE (product_id);


-- 2. Remove the old product + line unique constraint.
ALTER TABLE production_serial_rules
DROP INDEX uq_production_serial_rules_product_line;


-- 3. Remove the line_id foreign key FIRST.
ALTER TABLE production_serial_rules
DROP FOREIGN KEY fk_production_serial_rules_line;


-- 4. Remove the line_id supporting index.
ALTER TABLE production_serial_rules
DROP INDEX fk_production_serial_rules_line;


-- 5. Remove line_id.
ALTER TABLE production_serial_rules
DROP COLUMN line_id;


-- ============================================================
-- 6. PRODUCTION QR BUCKETS
-- ============================================================

CREATE TABLE production_qr_buckets (
    id INT AUTO_INCREMENT PRIMARY KEY,

    product_id INT NOT NULL,

    current_year INT NOT NULL,
    current_week INT NOT NULL,

    start_serial INT NOT NULL,
    end_serial INT NOT NULL,

    generated_qty INT NOT NULL DEFAULT 0,
    printed_qty INT NOT NULL DEFAULT 0,

    status ENUM(
        'GENERATED',
        'PRINTING',
        'COMPLETED'
    ) NOT NULL DEFAULT 'GENERATED',

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_production_qr_buckets_product
        FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    INDEX idx_production_qr_buckets_product (product_id),

    INDEX idx_production_qr_buckets_product_week
        (product_id, current_year, current_week)
);


-- ============================================================
-- 7. PRODUCTION QR CODES
-- ============================================================

CREATE TABLE production_qr_codes (
    id INT AUTO_INCREMENT PRIMARY KEY,

    bucket_id INT NOT NULL,
    product_id INT NOT NULL,

    serial_no VARCHAR(255) NOT NULL,
    qr_data VARCHAR(255) NOT NULL,

    status ENUM(
        'GENERATED',
        'PRINTED',
        'VOID'
    ) NOT NULL DEFAULT 'GENERATED',

    printed_at DATETIME NULL,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_production_qr_codes_bucket
        FOREIGN KEY (bucket_id)
        REFERENCES production_qr_buckets(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_production_qr_codes_product
        FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT uq_production_qr_codes_product_serial
        UNIQUE (product_id, serial_no),

    INDEX idx_production_qr_codes_bucket (bucket_id),

    INDEX idx_production_qr_codes_product_status
        (product_id, status)
);