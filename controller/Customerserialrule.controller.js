import { pool } from '../DB/config/mysql.config.js'; // adjust to your actual pool import path
import { asyncHandler, AppError } from '../utils/AppError.js';

// ---------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------

export const listCustomerSerialRules = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT r.*, p.name AS product_name
     FROM customer_serial_rules r
     LEFT JOIN products p ON p.id = r.product_id
     ORDER BY r.created_at DESC`
  );
  res.json({ data: rows });
});

export const getCustomerSerialRule = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT r.*, p.name AS product_name
     FROM customer_serial_rules r
     LEFT JOIN products p ON p.id = r.product_id
     WHERE r.id = ?`,
    [req.params.id]
  );
  if (!rows.length) throw new AppError('Customer serial rule not found', 404);
  res.json({ data: rows[0] });
});

export const createCustomerSerialRule = asyncHandler(async (req, res) => {
  const {
    customer_name,
    product_id,
    part_code,
    serial_width,
    is_active = true,
  } = req.body;

  if (!customer_name || !product_id || !part_code || !serial_width) {
    throw new AppError(
      "customer_name, product_id, part_code and serial_width are required",
      400
    );
  }

  if (serial_width < 1 || serial_width > 10) {
    throw new AppError(
      "serial_width must be between 1 and 10",
      400
    );
  }

  const [dupe] = await pool.query(
    `
    SELECT id
    FROM customer_serial_rules
    WHERE customer_name = ?
      AND product_id = ?
      AND part_code = ?
    `,
    [customer_name, product_id, part_code]
  );

  if (dupe.length) {
    throw new AppError(
      "A rule for this customer, product and part code already exists",
      409
    );
  }

  const now = new Date();

  const getIsoWeek = (date) => {
    const d = new Date(
      Date.UTC(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
      )
    );

    const day = d.getUTCDay() || 7;

    d.setUTCDate(d.getUTCDate() + 4 - day);

    const yearStart = new Date(
      Date.UTC(d.getUTCFullYear(), 0, 1)
    );

    return Math.ceil(
      (((d - yearStart) / 86400000) + 1) / 7
    );
  };

  const currentYear = now.getFullYear();
  const currentWeek = getIsoWeek(now);
  const nextSerial = 1;

  const [result] = await pool.query(
    `
    INSERT INTO customer_serial_rules
    (
      customer_name,
      product_id,
      part_code,
      serial_width,
      current_year,
      current_week,
      next_serial,
      is_active,
      created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      customer_name,
      product_id,
      part_code,
      serial_width,
      currentYear,
      currentWeek,
      nextSerial,
      is_active,
      req.user?.id ?? null,
    ]
  );

  res.status(201).json({
    data: {
      id: result.insertId,
    },
  });
});

export const updateCustomerSerialRule = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { customer_name, product_id, part_code, serial_width, is_active } = req.body;

  const [existing] = await pool.query(`SELECT id FROM customer_serial_rules WHERE id = ?`, [id]);
  if (!existing.length) throw new AppError('Customer serial rule not found', 404);

  await pool.query(
    `UPDATE customer_serial_rules
     SET customer_name = ?, product_id = ?, part_code = ?, serial_width = ?, is_active = ?, updated_at = NOW()
     WHERE id = ?`,
    [customer_name, product_id, part_code, serial_width, is_active, id]
  );

  res.json({ message: 'Rule updated' });
});

export const toggleCustomerSerialRuleActive = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query(`SELECT is_active FROM customer_serial_rules WHERE id = ?`, [id]);
  if (!rows.length) throw new AppError('Customer serial rule not found', 404);

  const nextState = !rows[0].is_active;
  await pool.query(`UPDATE customer_serial_rules SET is_active = ?, updated_at = NOW() WHERE id = ?`, [nextState, id]);
  res.json({ data: { is_active: nextState } });
});

export const deleteCustomerSerialRule = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [result] = await pool.query(`DELETE FROM customer_serial_rules WHERE id = ?`, [id]);
  if (!result.affectedRows) throw new AppError('Customer serial rule not found', 404);
  res.json({ message: 'Rule deleted' });
});

// Note: single-serial generation and the standalone preview endpoint
// that used to live here have moved to customerQrBatchController.js —
// generation is now batch-based against customer_qr_buckets /
// customer_qr_codes (see getGenerationPreview / generateCustomerQrBatch).