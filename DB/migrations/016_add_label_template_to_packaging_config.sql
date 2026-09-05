-- ============================================================
-- Migration 016
-- Add Master Label template reference to packaging_config
-- ============================================================

ALTER TABLE packaging_config
ADD COLUMN label_template_id INT NULL
AFTER barcode_rule;

ALTER TABLE packaging_config
ADD CONSTRAINT fk_packaging_config_label_template
FOREIGN KEY (label_template_id)
REFERENCES label_templates(id)
ON DELETE SET NULL
ON UPDATE CASCADE;