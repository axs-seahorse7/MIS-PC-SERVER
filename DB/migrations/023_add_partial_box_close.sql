
-- Allow packaging rules to control whether boxes
-- may be closed before reaching their configured capacity.

ALTER TABLE packaging_config
ADD COLUMN allow_partial_close TINYINT(1)
NOT NULL DEFAULT 0;
