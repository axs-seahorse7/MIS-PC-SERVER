-- ============================================================
-- 003: Change Production Order from Line-based to Factory-based
-- ============================================================

-- 1. Add factory_id temporarily as nullable
ALTER TABLE production_orders
ADD COLUMN factory_id INT NULL AFTER product_id;


-- 2. Populate factory_id from the existing production line
UPDATE production_orders po
INNER JOIN production_lines pl
    ON pl.id = po.line_id
SET po.factory_id = pl.factory_id;


-- 3. Make factory_id mandatory
ALTER TABLE production_orders
MODIFY COLUMN factory_id INT NOT NULL;


-- 4. Add Factory foreign key
ALTER TABLE production_orders
ADD CONSTRAINT fk_production_order_factory
    FOREIGN KEY (factory_id)
    REFERENCES factories(id);


-- 5. Remove old Line foreign key
ALTER TABLE production_orders
DROP FOREIGN KEY fk_production_order_line;


-- 6. Remove line_id because Production Order is no longer line-specific
ALTER TABLE production_orders
DROP COLUMN line_id;