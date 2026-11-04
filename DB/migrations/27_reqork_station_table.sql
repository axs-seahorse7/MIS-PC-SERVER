
-- Migration 027: Rework QA Approval Workflow

-- 1. Add PENDING_QA to production item status
ALTER TABLE production_order_items
    MODIFY COLUMN status ENUM(
        'ACTIVE',
        'REWORK',
        'PENDING_QA',
        'REJECTED'
    ) NOT NULL DEFAULT 'ACTIVE';

-- 2. Add rework submission and QA review fields
ALTER TABLE production_order_items
    ADD COLUMN rework_submitted_at DATETIME NULL
        AFTER rework_started_by,

    ADD COLUMN rework_completed_by INT NULL
        AFTER rework_submitted_at,

    ADD COLUMN qa_reviewed_by INT NULL
        AFTER rework_completed_by,

    ADD COLUMN qa_reviewed_at DATETIME NULL
        AFTER qa_reviewed_by,

    ADD COLUMN qa_remarks VARCHAR(500) NULL
        AFTER qa_reviewed_at,

    ADD KEY idx_order_item_qa_status (status, qa_reviewed_at),

    ADD CONSTRAINT fk_order_item_rework_completed_by
        FOREIGN KEY (rework_completed_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    ADD CONSTRAINT fk_order_item_qa_reviewed_by
        FOREIGN KEY (qa_reviewed_by)
        REFERENCES users(id)
        ON DELETE SET NULL;

-- 3. Extend quality history actions
ALTER TABLE production_item_quality_history
    MODIFY COLUMN action_type ENUM(
        'REWORK_STARTED',
        'REWORK_COMPLETED',
        'REJECTED',
        'REWORK_SUBMITTED',
        'QA_APPROVED',
        'QA_SENT_BACK'
    ) NOT NULL;
