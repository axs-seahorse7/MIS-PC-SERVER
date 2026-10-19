
import pool from "../DB/config/mysql.config.js";
import bcrypt from "bcrypt";
import { asyncHandler, AppError } from "../utils/AppError.js";

// GET /api/packaging-config/:configId/workers
export const getPartialBoxWorkers = asyncHandler(async (req, res) => {
  const { configId } = req.params;

  const [configs] = await pool.query(
    "SELECT id FROM packaging_config WHERE id = ?",
    [configId]
  );

  if (!configs.length) {
    throw new AppError("Packaging rule not found", 404);
  }

  const [workers] = await pool.query(
    `SELECT id, packaging_config_id, username, is_active, created_at, updated_at
     FROM partial_box_closure_workers
     WHERE packaging_config_id = ?
     ORDER BY id DESC`,
    [configId]
  );

  res.status(200).json({ success: true, data: workers });
});

// POST /api/packaging-config/:configId/workers
export const createPartialBoxWorker = asyncHandler(async (req, res) => {
  const { configId } = req.params;
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (!username || !password) {
    throw new AppError("Username and password are required", 400);
  }

  if (username.length > 100) {
    throw new AppError("Username cannot exceed 100 characters", 400);
  }

  if (password.length < 8 || password.length > 72) {
    throw new AppError(
      "Password must be between 8 and 72 characters",
      400
    );
  }

  const [configs] = await pool.query(
    `SELECT id, allow_partial_close
     FROM packaging_config
     WHERE id = ?`,
    [configId]
  );

  if (!configs.length) {
    throw new AppError("Packaging rule not found", 404);
  }

  if (!configs[0].allow_partial_close) {
    throw new AppError(
      "Enable partial closure for this packaging rule first",
      409
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const [result] = await pool.query(
      `INSERT INTO partial_box_closure_workers
       (packaging_config_id, username, password_hash, is_active)
       VALUES (?, ?, ?, 1)`,
      [configId, username, passwordHash]
    );

    res.status(201).json({
      success: true,
      message: "Packaging worker created",
      data: {
        id: result.insertId,
        packaging_config_id: Number(configId),
        username,
        is_active: 1,
      },
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw new AppError(
        "This username already exists for the packaging rule",
        409
      );
    }

    throw error;
  }
});

// PATCH /api/packaging-config/:configId/workers/:workerId
export const updatePartialBoxWorkerStatus = asyncHandler(
  async (req, res) => {
    const { configId, workerId } = req.params;
    const isActive = req.body.is_active;

    if (isActive !== true && isActive !== false &&
        isActive !== 1 && isActive !== 0) {
      throw new AppError("is_active must be true or false", 400);
    }

    const [result] = await pool.query(
      `UPDATE partial_box_closure_workers
       SET is_active = ?
       WHERE id = ? AND packaging_config_id = ?`,
      [Number(Boolean(isActive)), workerId, configId]
    );

    if (!result.affectedRows) {
      throw new AppError("Packaging worker not found", 404);
    }

    res.status(200).json({
      success: true,
      message: `Packaging worker ${isActive ? "activated" : "deactivated"}`,
    });
  }
);
