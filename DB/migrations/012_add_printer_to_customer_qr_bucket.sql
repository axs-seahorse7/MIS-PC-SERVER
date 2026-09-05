-- ============================================================
-- 012_add_printer_to_customer_qr_bucket.sql
--
-- Customer QR batch printing uses the existing `printers` table.
--
-- Rule      -> defines QR format
-- Bucket    -> defines customer/product/year/week + serial range
-- Printer   -> selected for the generated/printed batch
-- QR Codes  -> individual Customer QR inventory
-- ============================================================

-- 1. Add printer_id to Customer QR Bucket
ALTER TABLE customer_qr_buckets
  ADD COLUMN printer_id INT NULL
  AFTER generated_qty;

-- 2. Index for printer lookup
ALTER TABLE customer_qr_buckets
  ADD KEY idx_customer_qr_bucket_printer (printer_id);

-- 3. Link to the existing printers table
ALTER TABLE customer_qr_buckets
  ADD CONSTRAINT fk_customer_qr_bucket_printer
  FOREIGN KEY (printer_id)
  REFERENCES printers(id)
  ON DELETE SET NULL
  ON UPDATE CASCADE;
