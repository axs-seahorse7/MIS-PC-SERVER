-- ============================================================
-- Migration 020
-- Add Production Sub-Lines
-- ============================================================


-- ============================================================
-- 1. Create Production Sub-Lines
-- ============================================================

CREATE TABLE production_sub_lines (
    id INT AUTO_INCREMENT PRIMARY KEY,
    production_line_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_sub_line_production_line
        FOREIGN KEY (production_line_id)
        REFERENCES production_lines(id)
        ON DELETE CASCADE,

    CONSTRAINT uq_sub_line_code_per_line
        UNIQUE (production_line_id, code)
);


-- ============================================================
-- 2. Add Sub-Line to Stages
-- ============================================================

ALTER TABLE stages
ADD COLUMN sub_line_id INT NULL AFTER line_id;

ALTER TABLE stages
ADD CONSTRAINT fk_stage_sub_line
    FOREIGN KEY (sub_line_id)
    REFERENCES production_sub_lines(id)
    ON DELETE SET NULL;


-- ============================================================
-- Migration 020 Complete
-- ============================================================