CREATE TABLE customer_bindings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,

    pcb_qr VARCHAR(255) NOT NULL,
    customer_qr VARCHAR(255) NOT NULL,

    product_id BIGINT NOT NULL,
    production_order_id BIGINT NULL,

    factory_id BIGINT NOT NULL,
    line_id BIGINT NOT NULL,
    stage_id BIGINT NOT NULL,

    created_by BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_customer_binding_pcb (pcb_qr),
    INDEX idx_customer_binding_customer_qr (customer_qr),
    INDEX idx_customer_binding_production_order (production_order_id)
);