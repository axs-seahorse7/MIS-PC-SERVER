
-- Special-purpose credentials used only for partial box closure.
CREATE TABLE partial_box_closure_workers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    packaging_config_id INT NOT NULL,
    username VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_partial_worker_rule_username
        (packaging_config_id, username),
    KEY idx_partial_worker_active
        (packaging_config_id, is_active),

    CONSTRAINT fk_partial_worker_packaging_config
        FOREIGN KEY (packaging_config_id)
        REFERENCES packaging_config(id)
        ON DELETE RESTRICT
);

-- Immutable record of every successful early box closure.
CREATE TABLE partial_box_closure_audit (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    box_id INT NOT NULL,
    packaging_config_id INT NOT NULL,
    worker_id BIGINT UNSIGNED NOT NULL,
    product_id INT NOT NULL,
    actual_quantity INT NOT NULL,
    configured_box_size INT NOT NULL,
    reason VARCHAR(500) NOT NULL,
    closed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_partial_closure_audit_box (box_id),
    KEY idx_partial_closure_worker (worker_id, closed_at),
    KEY idx_partial_closure_product (product_id, closed_at),

    CONSTRAINT fk_partial_audit_box
        FOREIGN KEY (box_id) REFERENCES boxes(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_partial_audit_packaging_config
        FOREIGN KEY (packaging_config_id)
        REFERENCES packaging_config(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_partial_audit_worker
        FOREIGN KEY (worker_id)
        REFERENCES partial_box_closure_workers(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_partial_audit_product
        FOREIGN KEY (product_id) REFERENCES products(id)
        ON DELETE RESTRICT
);
