-- ============================================================
-- Migration 017
-- Create production serial number rules
-- ============================================================

CREATE TABLE production_serial_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,

    product_id INT NOT NULL,
    line_id INT NOT NULL,

    rule JSON NOT NULL,

    current_year INT NULL,
    current_week INT NULL,
    next_serial INT NOT NULL DEFAULT 1,

    is_active BOOLEAN NOT NULL DEFAULT 1,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_production_serial_rules_product
        FOREIGN KEY (product_id)
        REFERENCES products(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_production_serial_rules_line
        FOREIGN KEY (line_id)
        REFERENCES production_lines(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT uq_production_serial_rules_product_line
        UNIQUE (product_id, line_id)
);