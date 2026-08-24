ALTER TABLE scan_history
ADD COLUMN production_order_id INT NULL AFTER user_id,
ADD CONSTRAINT fk_scan_history_production_order
FOREIGN KEY (production_order_id)
REFERENCES production_orders(id);