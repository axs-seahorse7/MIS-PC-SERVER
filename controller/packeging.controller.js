import pool from "../DB/config/mysql.config.js";
import { asyncHandler, AppError } from "../utils/AppError.js";

const BARCODE_FORMATS = ["CODE128", "QR", "EAN13", "DATAMATRIX"];

// GET /api/packaging-config
export const getAllPackagingConfigs = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT pc.*, 
            p.name AS product_name,
            s.name AS stage_name,
            pr.printer_name AS printer_name
     FROM packaging_config pc
     LEFT JOIN products p ON p.id = pc.product_id
     LEFT JOIN product_stage_flow psf ON psf.id = pc.stage_id
     LEFT JOIN stages s ON s.id = psf.stage_id
     LEFT JOIN printers pr ON pr.id = pc.printer_id
     ORDER BY pc.updated_at DESC`
  );

  res.status(200).json(rows);
});

// GET /api/packaging-config/:id
export const getPackagingConfigById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [rows] = await pool.query(
    `SELECT pc.*, 
            p.name AS product_name,
            s.name AS stage_name,
            pr.printer_name AS printer_name
     FROM packaging_config pc
     LEFT JOIN products p ON p.id = pc.product_id
     LEFT JOIN product_stage_flow psf ON psf.id = pc.stage_id
     LEFT JOIN stages s ON s.id = psf.stage_id
     LEFT JOIN printers pr ON pr.id = pc.printer_id
     WHERE pc.id = ?`,
    [id]
  );

  if (!rows.length) {
    throw new AppError("Packaging rule not found", 404);
  }

  res.status(200).json(rows[0]);
});

// ------------------------------------------------------------------
// Server-side mirror of the frontend segment validation. Don't trust
// the client — someone could hit this endpoint directly with a bad
// payload (missing serial segment, zero width, etc).
// ------------------------------------------------------------------
const SEGMENT_TYPES = ["STATIC", "DATE", "SERIAL"];
const DATE_PARTS = ["YYYY", "YY", "MM", "DD", "WW"];

function validateBarcodeRule(barcodeRule) {
  if (!Array.isArray(barcodeRule) || barcodeRule.length === 0) {
    return "barcode_rule must be a non-empty array of segments";
  }

  const serialSegments = barcodeRule.filter((s) => s.type === "SERIAL");
  if (serialSegments.length === 0) {
    return "barcode_rule must include exactly one SERIAL segment";
  }
  if (serialSegments.length > 1) {
    return "barcode_rule can only include one SERIAL segment";
  }

  for (const seg of barcodeRule) {
    if (!SEGMENT_TYPES.includes(seg.type)) {
      return `Invalid segment type: ${seg.type}`;
    }

    if (seg.type === "STATIC") {
      if (!seg.value || !String(seg.value).trim()) {
        return "STATIC segment requires a non-empty value";
      }
    }

    if (seg.type === "DATE") {
      if (!Array.isArray(seg.parts) || seg.parts.length === 0) {
        return "DATE segment requires at least one part";
      }
      if (seg.parts.some((p) => !DATE_PARTS.includes(p))) {
        return `DATE segment parts must be one of: ${DATE_PARTS.join(", ")}`;
      }
    }

    if (seg.type === "SERIAL") {
      const { start, end, width } = seg;
      if (start == null || end == null || width == null) {
        return "SERIAL segment requires start, end and width";
      }
      if (Number(start) > Number(end)) {
        return "SERIAL start cannot be greater than end";
      }
      if (Number(width) < 1) {
        return "SERIAL width must be at least 1";
      }
      if (String(end).length > Number(width)) {
        return `SERIAL width (${width}) is too small for end value ${end}`;
      }
    }
  }

  return null;
}

// POST /api/packaging-config
export const createPackagingConfig = asyncHandler(async (req, res) => {
  const {
    product_id,
    stage_id,
    box_size,
    printer_id,
    barcode_format,
    barcode_rule,
    is_active,
  } = req.body;

  if (
    !product_id ||
    !stage_id ||
    !box_size ||
    !printer_id ||
    !barcode_format
  ) {
    throw new AppError(
      "product_id, stage_id, box_size, printer_id and barcode_format are required",
      400
    );
  }

  if (!BARCODE_FORMATS.includes(barcode_format)) {
    throw new AppError(
      `barcode_format must be one of: ${BARCODE_FORMATS.join(", ")}`,
      400
    );
  }

  const ruleError = validateBarcodeRule(barcode_rule);
  if (ruleError) {
    throw new AppError(ruleError, 400);
  }

  // Validate that the selected stage is actually PACKAGING
  const [stageRows] = await pool.query(
    `
    SELECT id, name
    FROM stages
    WHERE id = ?
      AND is_active = 1
    `,
    [stage_id]
  );

  if (!stageRows.length) {
    throw new AppError("Invalid stage", 400);
  }

  if (stageRows[0].name !== "PACKAGING") {
    throw new AppError(
      `Selected stage is "${stageRows[0].name}", not PACKAGING`,
      400
    );
  }

  // Duplicate rule check
  const [existing] = await pool.query(
    `
    SELECT id
    FROM packaging_config
    WHERE product_id = ?
      AND stage_id = ?
    `,
    [product_id, stage_id]
  );

  if (existing.length) {
    throw new AppError(
      "A packaging rule already exists for this product and stage",
      409
    );
  }

  // Counter starts at the SERIAL segment's configured `start` value so the
  // first generated barcode matches exactly what the preview showed.
  const serialSegment = barcode_rule.find((s) => s.type === "SERIAL");
  const initialSerial = Number(serialSegment.start);

  const [result] = await pool.query(
    `
    INSERT INTO packaging_config
      (
        product_id,
        stage_id,
        box_size,
        printer_id,
        barcode_format,
        barcode_rule,
        current_serial,
        is_active,
        created_at,
        updated_at
      )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `,
    [
      product_id,
      stage_id,
      box_size,
      printer_id,
      barcode_format,
      JSON.stringify(barcode_rule),
      initialSerial,
      is_active ?? true,
    ]
  );

  const [rows] = await pool.query(
    `SELECT * FROM packaging_config WHERE id = ?`,
    [result.insertId]
  );

  res.status(201).json(rows[0]);
});

// PUT /api/packaging-config/:id
export const updatePackagingConfig = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { product_id, stage_id, box_size, printer_id, barcode_format, barcode_rule, is_active } = req.body;

  if (!product_id || !stage_id || !box_size || !printer_id || !barcode_format) {
    throw new AppError(
      "product_id, stage_id, box_size, printer_id and barcode_format are required",
      400
    );
  }

  if (!BARCODE_FORMATS.includes(barcode_format)) {
    throw new AppError(`barcode_format must be one of: ${BARCODE_FORMATS.join(", ")}`, 400);
  }

  const ruleError = validateBarcodeRule(barcode_rule);
  if (ruleError) {
    throw new AppError(ruleError, 400);
  }

  const [existing] = await pool.query(`SELECT id, barcode_rule FROM packaging_config WHERE id = ?`, [id]);
  if (!existing.length) {
    throw new AppError("Packaging rule not found", 404);
  }

  // guard against duplicate rule for same product + stage (excluding self)
  const [dupe] = await pool.query(
    `SELECT id FROM packaging_config WHERE product_id = ? AND stage_id = ? AND id != ?`,
    [product_id, stage_id, id]
  );
  if (dupe.length) {
    throw new AppError("A packaging rule already exists for this product and stage", 409);
  }

  // If the rule structure actually changed (not just re-saved as-is), reset
  // the counter back to the new SERIAL segment's start — an old counter
  // value could be meaningless/out-of-range under a different rule shape.
  const previousRule = existing[0].barcode_rule;
  const ruleChanged = JSON.stringify(previousRule) !== JSON.stringify(barcode_rule);
  const serialSegment = barcode_rule.find((s) => s.type === "SERIAL");

  const setClauses = [
    "product_id = ?",
    "stage_id = ?",
    "box_size = ?",
    "printer_id = ?",
    "barcode_format = ?",
    "barcode_rule = ?",
    "is_active = ?",
  ];
  const values = [
    product_id,
    stage_id,
    box_size,
    printer_id,
    barcode_format,
    JSON.stringify(barcode_rule),
    is_active ?? true,
  ];

  if (ruleChanged) {
    setClauses.push("current_serial = ?", "serial_reset_key = NULL");
    values.push(Number(serialSegment.start));
  }

  await pool.query(
    `UPDATE packaging_config
     SET ${setClauses.join(", ")}, updated_at = NOW()
     WHERE id = ?`,
    [...values, id]
  );

  const [rows] = await pool.query(`SELECT * FROM packaging_config WHERE id = ?`, [id]);

  res.status(200).json(rows[0]);
});

// PATCH /api/packaging-config/:id  (partial update, e.g. is_active toggle)
export const patchPackagingConfig = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const allowedFields = [
    "product_id",
    "stage_id",
    "box_size",
    "printer_id",
    "barcode_format",
    "barcode_rule",
    "is_active",
  ];

  const updates = Object.entries(req.body).filter(([key]) => allowedFields.includes(key));

  if (!updates.length) {
    throw new AppError("No valid fields provided to update", 400);
  }

  if (
    updates.some(([key, val]) => key === "barcode_format" && !BARCODE_FORMATS.includes(val))
  ) {
    throw new AppError(`barcode_format must be one of: ${BARCODE_FORMATS.join(", ")}`, 400);
  }

  const barcodeRuleUpdate = updates.find(([key]) => key === "barcode_rule");
  if (barcodeRuleUpdate) {
    const ruleError = validateBarcodeRule(barcodeRuleUpdate[1]);
    if (ruleError) {
      throw new AppError(ruleError, 400);
    }
  }

  const [existing] = await pool.query(`SELECT id FROM packaging_config WHERE id = ?`, [id]);
  if (!existing.length) {
    throw new AppError("Packaging rule not found", 404);
  }

  const setClause = updates.map(([key]) => `${key} = ?`).join(", ");
  const values = updates.map(([key, val]) => (key === "barcode_rule" ? JSON.stringify(val) : val));

  await pool.query(
    `UPDATE packaging_config SET ${setClause}, updated_at = NOW() WHERE id = ?`,
    [...values, id]
  );

  const [rows] = await pool.query(`SELECT * FROM packaging_config WHERE id = ?`, [id]);

  res.status(200).json(rows[0]);
});

// DELETE /api/packaging-config/:id
export const deletePackagingConfig = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [existing] = await pool.query(`SELECT id FROM packaging_config WHERE id = ?`, [id]);
  if (!existing.length) {
    throw new AppError("Packaging rule not found", 404);
  }

  await pool.query(`DELETE FROM packaging_config WHERE id = ?`, [id]);

  res.status(200).json({ message: "Packaging rule deleted" });
});