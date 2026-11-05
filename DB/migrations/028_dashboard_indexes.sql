-- Support final-stage lookup for production orders
CREATE INDEX idx_pos_order_sequence
ON production_order_stages (
    production_order_id,
    sequence_order
);

-- Support date-based successful scan queries
CREATE INDEX idx_scan_dashboard_date
ON scan_history (
    scanned_at,
    status,
    production_order_id,
    stage_id
);