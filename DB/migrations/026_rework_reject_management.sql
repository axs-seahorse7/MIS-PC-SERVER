
-- ============================================================
-- Migration 026: Rework and Reject Management
-- Rework stations are scoped to Factory + Production Line.
-- ============================================================

-- 1. Rework Station Master
CREATE TABLE rework_stations (
    id INT NOT NULL AUTO_INCREMENT,
    factory_id INT NOT NULL,
    line_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) NOT NULL,
    description VARCHAR(500) NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_rework_station_line_code (line_id, code),
    UNIQUE KEY uq_rework_station_line_name (line_id, name),
    KEY idx_rework_station_factory_active (factory_id, is_active),
    KEY idx_rework_station_line_active (line_id, is_active),

    CONSTRAINT fk_rework_station_factory
        FOREIGN KEY (factory_id) REFERENCES factories(id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_rework_station_line
        FOREIGN KEY (line_id) REFERENCES production_lines(id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_rework_station_created_by
        FOREIGN KEY (created_by) REFERENCES users(id)
        ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


-- 2. Add REWORK status and current assignment metadata.
-- Existing rejected_at and rejected_by columns are retained.
ALTER TABLE production_order_items
    MODIFY COLUMN status ENUM('ACTIVE', 'REWORK', 'REJECTED')
        NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN rework_station_id INT NULL AFTER rejected_by,
    ADD COLUMN rework_started_at DATETIME NULL AFTER rework_station_id,
    ADD COLUMN rework_started_by INT NULL AFTER rework_started_at,
    ADD KEY idx_order_item_rework_station (rework_station_id, status),
    ADD CONSTRAINT fk_order_item_rework_station
        FOREIGN KEY (rework_station_id) REFERENCES rework_stations(id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT fk_order_item_rework_started_by
        FOREIGN KEY (rework_started_by) REFERENCES users(id)
        ON DELETE SET NULL;


-- 3. Immutable quality action history.
CREATE TABLE production_item_quality_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    production_order_item_id INT NOT NULL,
    action_type ENUM(
        'REWORK_STARTED',
        'REWORK_COMPLETED',
        'REJECTED'
    ) NOT NULL,
    rework_station_id INT NULL,
    stage_id INT NULL,
    reason VARCHAR(500) NULL,
    performed_by INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_quality_history_item_time
        (production_order_item_id, created_at),
    KEY idx_quality_history_action_time
        (action_type, created_at),
    KEY idx_quality_history_station_time
        (rework_station_id, created_at),

    CONSTRAINT fk_quality_history_order_item
        FOREIGN KEY (production_order_item_id)
        REFERENCES production_order_items(id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_quality_history_rework_station
        FOREIGN KEY (rework_station_id)
        REFERENCES rework_stations(id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_quality_history_stage
        FOREIGN KEY (stage_id) REFERENCES stages(id)
        ON DELETE SET NULL,
    CONSTRAINT fk_quality_history_performed_by
        FOREIGN KEY (performed_by) REFERENCES users(id)
        ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
