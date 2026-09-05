-- ============================================================
-- Migration 015
-- Add generic PRODUCT_QR template type
-- ============================================================

ALTER TABLE label_templates
MODIFY COLUMN template_type
ENUM(
    'PRODUCT_QR',
    'PCB_QR',
    'BOX_LABEL',
    'CUSTOMER_QR'
) NOT NULL;

ALTER TABLE printer_label_templates
MODIFY COLUMN template_type
ENUM(
    'PRODUCT_QR',
    'PCB_QR',
    'BOX_LABEL',
    'CUSTOMER_QR'
) NOT NULL;