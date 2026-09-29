-- ============================================================
-- Migration 019
-- Move machine_code from product_stage_flow → stages
--
-- Machine code belongs to the physical machine/stage configured
-- for a production line, not to an individual product.
-- ============================================================


-- ============================================================
-- 1. Add machine_code to stages
-- ============================================================

ALTER TABLE stages
ADD COLUMN machine_code VARCHAR(50) NULL AFTER name;


-- ============================================================
-- 2. Transfer existing machine codes
-- ============================================================

UPDATE stages s
JOIN (
    SELECT
        stage_id,
        MAX(machine_code) AS machine_code
    FROM product_stage_flow
    WHERE machine_code IS NOT NULL
    GROUP BY stage_id
) psf ON psf.stage_id = s.id
SET s.machine_code = psf.machine_code;


-- ============================================================
-- 3. Make machine_code globally unique
-- ============================================================

ALTER TABLE stages
ADD CONSTRAINT uq_stages_machine_code
UNIQUE (machine_code);


-- ============================================================
-- 4. Remove machine_code from product_stage_flow
-- ============================================================

ALTER TABLE product_stage_flow
DROP COLUMN machine_code;