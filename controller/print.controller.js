// PATCH /box-print-jobs/:id
import {pool} from "../DB/config/mysql.config.js";
import { asyncHandler } from "../utils/AppError.js";

export const updatePrintJobStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, error_message } = req.body;

  const ALLOWED = ["PRINTED", "FAILED"];
  if (!ALLOWED.includes(status)) {
    throw new AppError(`status must be one of: ${ALLOWED.join(", ")}`, 400);
  }

  await pool.query(
    `UPDATE box_print_jobs
     SET status = ?, error_message = ?, printed_at = ?, attempts = attempts + 1, updated_at = NOW()
     WHERE id = ?`,
    [status, error_message || null, status === "PRINTED" ? new Date() : null, id]
  );

  const [rows] = await pool.query(`SELECT * FROM box_print_jobs WHERE id = ?`, [id]);
  if (!rows.length) throw new AppError("Print job not found", 404);

  res.status(200).json(rows[0]);
});