ALTER TABLE production_orders
ADD COLUMN line_id INT NOT NULL AFTER product_id,
ADD CONSTRAINT fk_production_order_line
    FOREIGN KEY (line_id)
    REFERENCES production_lines(id);