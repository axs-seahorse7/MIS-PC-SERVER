-- ============================================================
-- Migration 027: Rework QA Approval Workflow
-- ============================================================

ALTER TABLE production_order_items
    MODIFY COLUMN status ENUM(
        'ACTIVE',
        'REWORK',
        'PENDING_QA',
        'REJECTED'
    ) NOT NULL DEFAULT 'ACTIVE',

    ADD COLUMN rework_submitted_at DATETIME NULL
        AFTER rework_started_by,

    ADD COLUMN rework_completed_by INT NULL
        AFTER rework_submitted_at,

    ADD COLUMN qa_approved_by INT NULL
        AFTER rework_completed_by,

    ADD COLUMN qa_approved_at DATETIME NULL
        AFTER qa_approved_by,

    ADD COLUMN qa_remarks VARCHAR(500) NULL
        AFTER qa_approved_at,

    ADD KEY idx_order_item_qa_status (status, qa_approved_at),

    ADD CONSTRAINT fk_order_item_rework_completed_by
        FOREIGN KEY (rework_completed_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    ADD CONSTRAINT fk_order_item_qa_approved_by
        FOREIGN KEY (qa_approved_by)
        REFERENCES users(id)
        ON DELETE SET NULL;