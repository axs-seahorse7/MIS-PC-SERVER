// controllers/productionTargetController.js
import { pool } from "../DB/config/mysql.config.js"; 
import { asyncHandler } from "../utils/AppError.js";
import { AppError } from "../utils/AppError.js";

// ---- GET /production-targets?factory_id=&line_id=&date= ----
export const getProductionTargets = asyncHandler(async (req, res) => {
  const { factory_id, line_id, date } = req.query;

  if (!factory_id || !date) {
    throw new AppError("factory_id and date are required", 400);
  }

  const conditions = ["pt.factory_id = ?", "pt.target_date = ?"];
  const params = [factory_id, date];

  if (line_id) {
    conditions.push("pt.line_id = ?");
    params.push(line_id);
  }

  const [rows] = await pool.query(
  `SELECT pt.id, pt.factory_id, pt.line_id, pt.product_id, pt.target_date,
          pt.target_quantity, pt.created_by, pt.created_at, pt.updated_at,
          p.name AS product_name, p.erp_no,
          l.name AS line_name,
          f.name AS factory_name
   FROM production_targets pt
   LEFT JOIN products p ON p.id = pt.product_id
   LEFT JOIN production_lines l ON l.id = pt.line_id
   LEFT JOIN factories f ON f.id = pt.factory_id
   WHERE ${conditions.join(" AND ")}
   ORDER BY pt.target_date DESC, p.name ASC`,
  params
);

  return res.status(200).json({ success: true, data: rows });
});

// Get /production-targets by line_id and product_id
export const getProductionTargetsByLineAndProduct = asyncHandler(async (req, res) => {
  const { line_id, product_id } = req.params;

  const [rows] = await pool.query(
    `SELECT pt.id, pt.factory_id, pt.line_id, pt.product_id, pt.target_date,
            pt.target_quantity, pt.created_by, pt.created_at, pt.updated_at,
            p.name AS product_name, p.erp_no,
            l.name AS line_name,
            f.name AS factory_name
     FROM production_targets pt
     LEFT JOIN products p ON p.id = pt.product_id
     LEFT JOIN production_lines l ON l.id = pt.line_id
     LEFT JOIN factories f ON f.id = pt.factory_id
     WHERE pt.line_id = ? AND pt.product_id = ?
     ORDER BY pt.target_date DESC, p.name ASC`,
    [line_id, product_id]
  );

  return res.status(200).json({ success: true, data: rows });
});

// ---- POST /production-targets  (create, with upsert-on-duplicate) ----
export const createProductionTarget = asyncHandler(async (req, res) => {
  const { factory_id, line_id, product_id, target_date, target_quantity } = req.body;
  const created_by = req?.user?.id;

  if (!factory_id || !line_id || !product_id || !target_date) {
    throw new AppError("factory_id, line_id, product_id, and target_date are required", 400);
  }
  if (target_quantity === undefined || target_quantity === null || target_quantity <= 0) {
    throw new AppError("target_quantity must be a positive number", 400);
  }
  if (!created_by) {
    throw new AppError("Unable to identify current user", 401);
  }

  const conn = await pool.getConnection();
  try {
    // check for an existing target on the same factory+line+product+date
    const [existing] = await conn.query(
      `SELECT id FROM production_targets
       WHERE factory_id = ? AND line_id = ? AND product_id = ? AND target_date = ?
       LIMIT 1`,
      [factory_id, line_id, product_id, target_date]
    );

    if (existing.length) {
      // upsert: update the existing row rather than erroring, since the
      // person is very likely just re-setting today's number
      await conn.query(
        `UPDATE production_targets SET target_quantity = ? WHERE id = ?`,
        [target_quantity, existing[0].id]
      );
      return res.status(200).json({
        success: true,
        message: "Existing target updated",
        data: { id: existing[0].id, updated: true },
      });
    }

    const [result] = await conn.query(
      `INSERT INTO production_targets
        (factory_id, line_id, product_id, target_date, target_quantity, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [factory_id, line_id, product_id, target_date, target_quantity, created_by]
    );

    return res.status(201).json({
      success: true,
      message: "Target created",
      data: { id: result.insertId, updated: false },
    });
  } finally {
    conn.release();
  }
});

// ---- PUT /production-targets/:id ----
export const updateProductionTarget = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { factory_id, line_id, product_id, target_date, target_quantity } = req.body;

  if (!id) throw new AppError("Target id is required", 400);
  if (target_quantity === undefined || target_quantity === null || target_quantity <= 0) {
    throw new AppError("target_quantity must be a positive number", 400);
  }

  const conn = await pool.getConnection();
  try {
    const [existing] = await conn.query(`SELECT id FROM production_targets WHERE id = ?`, [id]);
    if (!existing.length) {
      throw new AppError("Target not found", 404);
    }

    // guard against editing into a collision with a different existing row
    const [collision] = await conn.query(
      `SELECT id FROM production_targets
       WHERE factory_id = ? AND line_id = ? AND product_id = ? AND target_date = ? AND id != ?
       LIMIT 1`,
      [factory_id, line_id, product_id, target_date, id]
    );
    if (collision.length) {
      throw new AppError("A target already exists for this factory/line/product/date", 409);
    }

    await conn.query(
      `UPDATE production_targets
       SET factory_id = ?, line_id = ?, product_id = ?, target_date = ?, target_quantity = ?
       WHERE id = ?`,
      [factory_id, line_id, product_id, target_date, target_quantity, id]
    );

    return res.status(200).json({ success: true, message: "Target updated" });
  } finally {
    conn.release();
  }
});

// ---- DELETE /production-targets/:id ----
export const deleteProductionTarget = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id) throw new AppError("Target id is required", 400);

  const [result] = await pool.query(`DELETE FROM production_targets WHERE id = ?`, [id]);
  if (result.affectedRows === 0) {
    throw new AppError("Target not found", 404);
  }

  return res.status(200).json({ success: true, message: "Target deleted" });
});