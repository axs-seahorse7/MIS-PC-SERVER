
-- Migration 022: Product + line serial allocation.
-- Does not modify existing serial values or production orders.

-- 1. Create a counter per product + line.
CREATE TABLE production_order_serial_counters (
    product_id INT NOT NULL,
    line_id INT NOT NULL,
    next_serial BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (product_id, line_id),

    CONSTRAINT fk_po_serial_counter_product
        FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_po_serial_counter_line
        FOREIGN KEY (line_id)
        REFERENCES production_lines(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

-- 2. Replace global serial uniqueness with product + line uniqueness.
ALTER TABLE production
    DROP INDEX serial_no,
    ADD CONSTRAINT uq_production_product_line_serial
        UNIQUE (product_id, line_id, serial_no);
