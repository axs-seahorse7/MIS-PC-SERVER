-- ============================================================
-- Migration 014
-- Product Print Jobs
-- ============================================================
CREATE TABLE product_print_jobs (
    id INT AUTO_INCREMENT PRIMARY KEY,

    production_order_id INT NOT NULL,
    printer_id INT NOT NULL,
    template_id INT NOT NULL,

    quantity INT NOT NULL,

    status ENUM(
        'CREATED',
        'SUBMITTED',
        'COMPLETED',
        'FAILED',
        'CANCELLED'
    ) NOT NULL DEFAULT 'CREATED',

    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_product_print_jobs_order (production_order_id),
    INDEX idx_product_print_jobs_printer (printer_id),
    INDEX idx_product_print_jobs_template (template_id),
    INDEX idx_product_print_jobs_status (status),

    CONSTRAINT fk_product_print_jobs_order
        FOREIGN KEY (production_order_id)
        REFERENCES production_orders(id),

    CONSTRAINT fk_product_print_jobs_printer
        FOREIGN KEY (printer_id)
        REFERENCES printers(id),

    CONSTRAINT fk_product_print_jobs_template
        FOREIGN KEY (template_id)
        REFERENCES label_templates(id)
);

-- ============================================================
-- Individual production items in a print job
-- ============================================================

CREATE TABLE product_print_job_items (
    id INT AUTO_INCREMENT PRIMARY KEY,

    print_job_id INT NOT NULL,
    production_order_item_id INT NOT NULL,

    status ENUM(
        'PENDING',
        'PRINTED',
        'FAILED'
    ) NOT NULL DEFAULT 'PENDING',

    printed_at DATETIME NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_product_print_job_items_job (
        print_job_id
    ),

    INDEX idx_product_print_job_items_item (
        production_order_item_id
    ),

    INDEX idx_product_print_job_items_status (
        status
    ),

    CONSTRAINT fk_product_print_job_items_job
        FOREIGN KEY (print_job_id)
        REFERENCES product_print_jobs(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_product_print_job_items_item
        FOREIGN KEY (production_order_item_id)
        REFERENCES production_order_items(id),

    UNIQUE KEY uq_product_print_job_item (
        print_job_id,
        production_order_item_id
    )
);