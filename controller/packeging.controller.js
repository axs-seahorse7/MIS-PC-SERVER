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

// POST /api/packaging-config
export const createPackagingConfig = asyncHandler(async (req, res) => {
  const {
    product_id,
    stage_id,
    box_size,
    printer_id,
    barcode_format,
    is_active
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

  const [result] = await pool.query(
    `
    INSERT INTO packaging_config
      (
        product_id,
        stage_id,
        box_size,
        printer_id,
        barcode_format,
        is_active,
        created_at,
        updated_at
      )
    VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
    `,
    [
      product_id,
      stage_id,
      box_size,
      printer_id,
      barcode_format,
      is_active ?? true
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
  const { product_id, stage_id, box_size, printer_id, barcode_format, is_active } = req.body;

  if (!product_id || !stage_id || !box_size || !printer_id || !barcode_format) {
    throw new AppError(
      "product_id, stage_id, box_size, printer_id and barcode_format are required",
      400
    );
  }

  if (!BARCODE_FORMATS.includes(barcode_format)) {
    throw new AppError(`barcode_format must be one of: ${BARCODE_FORMATS.join(", ")}`, 400);
  }

  const [existing] = await pool.query(`SELECT id FROM packaging_config WHERE id = ?`, [id]);
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

  await pool.query(
    `UPDATE packaging_config
     SET product_id = ?, stage_id = ?, box_size = ?, printer_id = ?, 
         barcode_format = ?, is_active = ?, updated_at = NOW()
     WHERE id = ?`,
    [product_id, stage_id, box_size, printer_id, barcode_format, is_active ?? true, id]
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

  const [existing] = await pool.query(`SELECT id FROM packaging_config WHERE id = ?`, [id]);
  if (!existing.length) {
    throw new AppError("Packaging rule not found", 404);
  }

  const setClause = updates.map(([key]) => `${key} = ?`).join(", ");
  const values = updates.map(([, val]) => val);

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