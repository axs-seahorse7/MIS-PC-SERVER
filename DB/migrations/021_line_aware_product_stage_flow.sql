
-- Migration 021: Line-aware product stage flows.
-- Backfill line_id from the existing stage-to-line mapping.

-- 1. Add line_id to product_stage_flow.
ALTER TABLE product_stage_flow
    ADD COLUMN line_id INT NULL AFTER product_id;

-- 2. Populate each flow's line from its existing stage.
UPDATE product_stage_flow psf
JOIN stages s ON s.id = psf.stage_id
SET psf.line_id = s.line_id;

-- 3. Stop if any flow could not be mapped.
-- Verify this query returns 0 before continuing:
-- SELECT COUNT(*) FROM product_stage_flow WHERE line_id IS NULL;

-- 4. Require a valid line for every flow.
ALTER TABLE product_stage_flow
    MODIFY COLUMN line_id INT NOT NULL;

-- 5. Remove old product-only unique indexes.
ALTER TABLE product_stage_flow
    DROP INDEX uq_product_stage,
    DROP INDEX uq_product_sequence;

-- 6. Renumber sequences independently per product and line.
CREATE TEMPORARY TABLE tmp_psf_line_sequence AS
SELECT
    id,
    ROW_NUMBER() OVER (
        PARTITION BY product_id, line_id
        ORDER BY sequence_no, id
    ) AS new_sequence_no
FROM product_stage_flow;

UPDATE product_stage_flow psf
JOIN tmp_psf_line_sequence t ON t.id = psf.id
SET psf.sequence_no = t.new_sequence_no;

DROP TEMPORARY TABLE tmp_psf_line_sequence;

-- 7. Add line-aware unique constraints and foreign key.
ALTER TABLE product_stage_flow
    ADD CONSTRAINT uq_product_line_stage
        UNIQUE (product_id, line_id, stage_id),
    ADD CONSTRAINT uq_product_line_sequence
        UNIQUE (product_id, line_id, sequence_no),
    ADD CONSTRAINT fk_psf_line
        FOREIGN KEY (line_id)
        REFERENCES production_lines(id);
