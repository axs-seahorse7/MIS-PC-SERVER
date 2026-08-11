import pool from "../DB/config/mysql.config.js"; // adjust to actual MySQL pool path
import {asyncHandler} from "../utils/AppError.js";
import {AppError} from "../utils/AppError.js";

const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

// GET /api/printers
export const getAllPrinters = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`SELECT * FROM printers ORDER BY updated_at DESC`);
  res.status(200).json(rows);
});

// GET /api/printers/:id
export const getPrinterById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [rows] = await pool.query(`SELECT * FROM printers WHERE id = ?`, [id]);

  if (!rows.length) {
    throw new AppError("Printer not found", 404);
  }

  res.status(200).json(rows[0]);
});

// POST /api/printers
export const createPrinter = asyncHandler(async (req, res) => {
  const { name, printer_type, ip_address, port, printer_name, is_active } = req.body;

  if (!name || !printer_type || !ip_address || !port || !printer_name) {
    throw new AppError(
      "name, printer_type, ip_address, port and printer_name are required",
      400
    );
  }

  if (!IP_REGEX.test(ip_address)) {
    throw new AppError("ip_address must be a valid IPv4 address", 400);
  }

  if (port < 1 || port > 65535) {
    throw new AppError("port must be between 1 and 65535", 400);
  }

  // guard against duplicate ip_address + port pair
  const [existing] = await pool.query(
    `SELECT id FROM printers WHERE ip_address = ? AND port = ?`,
    [ip_address, port]
  );
  if (existing.length) {
    throw new AppError("A printer already exists with this IP address and port", 409);
  }

  const [result] = await pool.query(
    `INSERT INTO printers
       (name, printer_type, ip_address, port, printer_name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [name, printer_type, ip_address, port, printer_name, is_active ?? true]
  );

  const [rows] = await pool.query(`SELECT * FROM printers WHERE id = ?`, [result.insertId]);

  res.status(201).json(rows[0]);
});

// PUT /api/printers/:id
export const updatePrinter = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, printer_type, ip_address, port, printer_name, is_active } = req.body;

  if (!name || !printer_type || !ip_address || !port || !printer_name) {
    throw new AppError(
      "name, printer_type, ip_address, port and printer_name are required",
      400
    );
  }

  if (!IP_REGEX.test(ip_address)) {
    throw new AppError("ip_address must be a valid IPv4 address", 400);
  }

  if (port < 1 || port > 65535) {
    throw new AppError("port must be between 1 and 65535", 400);
  }

  const [existing] = await pool.query(`SELECT id FROM printers WHERE id = ?`, [id]);
  if (!existing.length) {
    throw new AppError("Printer not found", 404);
  }

  const [dupe] = await pool.query(
    `SELECT id FROM printers WHERE ip_address = ? AND port = ? AND id != ?`,
    [ip_address, port, id]
  );
  if (dupe.length) {
    throw new AppError("A printer already exists with this IP address and port", 409);
  }

  await pool.query(
    `UPDATE printers
     SET name = ?, printer_type = ?, ip_address = ?, port = ?, 
         printer_name = ?, is_active = ?, updated_at = NOW()
     WHERE id = ?`,
    [name, printer_type, ip_address, port, printer_name, is_active ?? true, id]
  );

  const [rows] = await pool.query(`SELECT * FROM printers WHERE id = ?`, [id]);

  res.status(200).json(rows[0]);
});

// PATCH /api/printers/:id  (partial update, e.g. is_active toggle)
export const patchPrinter = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const allowedFields = ["name", "printer_type", "ip_address", "port", "printer_name", "is_active"];

  const updates = Object.entries(req.body).filter(([key]) => allowedFields.includes(key));

  if (!updates.length) {
    throw new AppError("No valid fields provided to update", 400);
  }

  if (updates.some(([key, val]) => key === "ip_address" && !IP_REGEX.test(val))) {
    throw new AppError("ip_address must be a valid IPv4 address", 400);
  }

  const [existing] = await pool.query(`SELECT id FROM printers WHERE id = ?`, [id]);
  if (!existing.length) {
    throw new AppError("Printer not found", 404);
  }

  const setClause = updates.map(([key]) => `${key} = ?`).join(", ");
  const values = updates.map(([, val]) => val);

  await pool.query(`UPDATE printers SET ${setClause}, updated_at = NOW() WHERE id = ?`, [
    ...values,
    id,
  ]);

  const [rows] = await pool.query(`SELECT * FROM printers WHERE id = ?`, [id]);

  res.status(200).json(rows[0]);
});

// DELETE /api/printers/:id
export const deletePrinter = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [existing] = await pool.query(`SELECT id FROM printers WHERE id = ?`, [id]);
  if (!existing.length) {
    throw new AppError("Printer not found", 404);
  }

  // guard: don't allow deleting a printer that's still referenced by packaging_config
  const [inUse] = await pool.query(
    `SELECT id FROM packaging_config WHERE printer_id = ? LIMIT 1`,
    [id]
  );
  if (inUse.length) {
    throw new AppError(
      "This printer is in use by one or more packaging rules and cannot be deleted",
      409
    );
  }

  await pool.query(`DELETE FROM printers WHERE id = ?`, [id]);

  res.status(200).json({ message: "Printer deleted" });
});