-- ============================================================
-- Migration: Create Production Order Architecture
-- ============================================================

-- ============================================================
-- 1. production_orders
-- ============================================================

CREATE TABLE IF NOT EXISTS production_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,

    order_no VARCHAR(50) NOT NULL UNIQUE,

    product_id INT NOT NULL,
    line_id INT NOT NULL,

    target_qty INT NOT NULL,

    serial_prefix VARCHAR(50) NOT NULL,
    serial_start INT NOT NULL,
    serial_end INT NOT NULL,
    serial_width INT NOT NULL DEFAULT 5,

    sequence_mode ENUM('SEQUENTIAL', 'NON_SEQUENTIAL')
        NOT NULL DEFAULT 'NON_SEQUENTIAL',

    status ENUM(
        'PLANNED',
        'RUNNING',
        'PAUSED',
        'COMPLETED',
        'CANCELLED'
    ) NOT NULL DEFAULT 'PLANNED',

    planned_date DATE NOT NULL,

    started_at DATETIME NULL,
    completed_at DATETIME NULL,

    created_by INT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_production_order_product
        FOREIGN KEY (product_id)
        REFERENCES products(id),

    CONSTRAINT fk_production_order_line
        FOREIGN KEY (line_id)
        REFERENCES production_lines(id),

    CONSTRAINT fk_production_order_created_by
        FOREIGN KEY (created_by)
        REFERENCES users(id),

    CONSTRAINT chk_production_order_target
        CHECK (target_qty > 0),

    CONSTRAINT chk_production_order_serial_range
        CHECK (serial_start <= serial_end)
);


-- ============================================================
-- 2. production_order_stages
-- ============================================================

CREATE TABLE IF NOT EXISTS production_order_stages (
    id INT AUTO_INCREMENT PRIMARY KEY,

    production_order_id INT NOT NULL,
    stage_id INT NOT NULL,

    sequence_order INT NOT NULL,

    next_expected_sequence INT NULL,

    status ENUM(
        'PENDING',
        'RUNNING',
        'COMPLETED'
    ) NOT NULL DEFAULT 'PENDING',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_order_stage_order
        FOREIGN KEY (production_order_id)
        REFERENCES production_orders(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_order_stage_stage
        FOREIGN KEY (stage_id)
        REFERENCES stages(id),

    CONSTRAINT uq_order_stage
        UNIQUE (production_order_id, stage_id),

    CONSTRAINT uq_order_stage_sequence
        UNIQUE (production_order_id, sequence_order)
);


-- ============================================================
-- 3. production_order_items
-- ============================================================

CREATE TABLE IF NOT EXISTS production_order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,

    production_order_id INT NOT NULL,

    serial_no VARCHAR(100) NOT NULL,
    sequence_no INT NOT NULL,

    status ENUM(
        'ACTIVE',
        'REJECTED'
    ) NOT NULL DEFAULT 'ACTIVE',

    rejected_at DATETIME NULL,
    rejected_by INT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_order_item_order
        FOREIGN KEY (production_order_id)
        REFERENCES production_orders(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_order_item_rejected_by
        FOREIGN KEY (rejected_by)
        REFERENCES users(id),

    CONSTRAINT uq_order_item_serial
        UNIQUE (production_order_id, serial_no),

    CONSTRAINT uq_order_item_sequence
        UNIQUE (production_order_id, sequence_no)
);