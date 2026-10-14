
-- Migration 021: Line-aware product stage flows.
-- Current state: line_id and idx_psf_stage_id already exist.

-- 1. Replace old product-only unique indexes with line-aware indexes.
ALTER TABLE product_stage_flow
    DROP INDEX uq_product_stage,
    DROP INDEX uq_product_sequence,
    ADD CONSTRAINT uq_product_line_stage
        UNIQUE (product_id, line_id, stage_id),
    ADD CONSTRAINT uq_product_line_sequence
        UNIQUE (product_id, line_id, sequence_no);

-- 2. Restart sequence numbering independently for each product and line.
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

-- 3. Add the line foreign key.
ALTER TABLE product_stage_flow
    ADD CONSTRAINT fk_psf_line
        FOREIGN KEY (line_id)
        REFERENCES production_lines(id);
