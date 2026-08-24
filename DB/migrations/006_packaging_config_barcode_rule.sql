ALTER TABLE packaging_config
ADD COLUMN barcode_rule JSON NULL AFTER barcode_format,
ADD COLUMN current_serial INT NOT NULL DEFAULT 0 AFTER barcode_rule,
ADD COLUMN serial_reset_key VARCHAR(20) NULL AFTER current_serial;