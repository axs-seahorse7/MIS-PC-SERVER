CREATE TABLE label_templates (
    id INT NOT NULL AUTO_INCREMENT,

    name VARCHAR(150) NOT NULL,

    template_type ENUM(
        'PCB_QR',
        'BOX_LABEL',
        'CUSTOMER_QR'
    ) NOT NULL,

    dpi INT NOT NULL DEFAULT 300,

    width INT NOT NULL,
    height INT NOT NULL,

    pitch_x INT DEFAULT NULL,
    pitch_y INT DEFAULT NULL,

    elements JSON NOT NULL,

    is_active TINYINT(1) NOT NULL DEFAULT 1,

    created_by INT DEFAULT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    CONSTRAINT fk_label_templates_created_by
        FOREIGN KEY (created_by)
        REFERENCES users(id)
        ON DELETE SET NULL,

    INDEX idx_label_templates_type (template_type),
    INDEX idx_label_templates_dpi (dpi),
    INDEX idx_label_templates_active (is_active)
);


CREATE TABLE printer_label_templates (
    id INT NOT NULL AUTO_INCREMENT,

    printer_id INT NOT NULL,
    template_id INT NOT NULL,

    template_type ENUM(
        'PCB_QR',
        'BOX_LABEL',
        'CUSTOMER_QR'
    ) NOT NULL,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),

    CONSTRAINT fk_printer_label_templates_printer
        FOREIGN KEY (printer_id)
        REFERENCES printers(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_printer_label_templates_template
        FOREIGN KEY (template_id)
        REFERENCES label_templates(id)
        ON DELETE CASCADE,

    UNIQUE KEY uq_printer_template_type (
        printer_id,
        template_type
    ),

    INDEX idx_printer_label_templates_template (
        template_id
    )
);