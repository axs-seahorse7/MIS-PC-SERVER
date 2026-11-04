
import { pool } from "../DB/config/mysql.config.js";

const getUserContext = async (conn, userId) => {
  const [rows] = await conn.query(
    `SELECT id, factory_id, line_id, stage_id
     FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );

  if (!rows.length) throw Object.assign(new Error("User not found"), { status: 401 });
  return rows[0];
};

const getActiveStation = async (conn, stationId, factoryId, lineId) => {
  const [rows] = await conn.query(
    `SELECT id, name, code, factory_id, line_id
     FROM rework_stations
     WHERE id = ? AND factory_id = ? AND line_id = ? AND is_active = 1
     LIMIT 1`,
    [stationId, factoryId, lineId]
  );

  if (!rows.length) {
    throw Object.assign(
      new Error("Invalid or inactive rework station for this factory and line."),
      { status: 400 }
    );
  }

  return rows[0];
};

const getProductionItem = async (conn, serialNo, factoryId, lineId) => {
  const [rows] = await conn.query(
    `SELECT
        poi.id AS item_id,
        poi.production_order_id,
        poi.serial_no,
        poi.sequence_no,
        poi.status AS item_status,
        poi.rework_station_id,
        po.order_no
     FROM production_order_items poi
     INNER JOIN production_orders po
       ON po.id = poi.production_order_id
     WHERE poi.serial_no = ?
       AND po.factory_id = ?
       AND po.line_id = ?
       AND po.status = 'RUNNING'
     ORDER BY po.id DESC
     LIMIT 1
     FOR UPDATE`,
    [serialNo, factoryId, lineId]
  );

  if (!rows.length) {
    throw Object.assign(
      new Error("Serial not found in a running production order for this line."),
      { status: 404 }
    );
  }

  return rows[0];
};

// ----------------------------------------------------
// GET /api/quality/stations
// ----------------------------------------------------
export const getReworkStations = async (req, res) => {
  try {
    const conn = await pool.getConnection();

    try {
      const user = await getUserContext(conn, req.user.id);

      const [rows] = await conn.query(
        `SELECT id, factory_id, line_id, name, code, description,
                is_active, created_at
         FROM rework_stations
         WHERE factory_id = ?
           AND (? IS NULL OR line_id = ?)
         ORDER BY name`,
        [user.factory_id, user.line_id, user.line_id]
      );

      return res.json({ success: true, data: rows });
    } finally {
      conn.release();
    }
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message,
    });
  }
};

// ----------------------------------------------------
// POST /api/quality/stations
// ----------------------------------------------------
export const createReworkStation = async (req, res) => {
  const conn = await pool.getConnection();

  try {
    const user = await getUserContext(conn, req.user.id);
    const { line_id, name, code, description } = req.body;

    if (!user.factory_id) {
      return res.status(400).json({
        success: false,
        message: "Your user is not assigned to a factory.",
      });
    }

    if (!line_id || !name?.trim() || !code?.trim()) {
      return res.status(400).json({
        success: false,
        message: "line_id, name and code are required.",
      });
    }

    // A line must belong to the authenticated user's factory.
    const [lineRows] = await conn.query(
      `SELECT id FROM production_lines
       WHERE id = ? AND factory_id = ? AND is_active = 1`,
      [line_id, user.factory_id]
    );

    if (!lineRows.length) {
      return res.status(400).json({
        success: false,
        message: "Selected line does not belong to your factory or is inactive.",
      });
    }

    const [result] = await conn.query(
      `INSERT INTO rework_stations
       (factory_id, line_id, name, code, description, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        user.factory_id,
        line_id,
        name.trim(),
        code.trim().toUpperCase(),
        description?.trim() || null,
        user.id,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Rework station created successfully.",
      data: { id: result.insertId },
    });
  } catch (error) {
    const duplicate = error.code === "ER_DUP_ENTRY";

    return res.status(duplicate ? 409 : error.status || 500).json({
      success: false,
      message: duplicate
        ? "A station with this name or code already exists on this line."
        : error.message,
    });
  } finally {
    conn.release();
  }
};

// ----------------------------------------------------
// POST /api/quality/rework/start
// ----------------------------------------------------
export const startRework = async (req, res) => {
  const conn = await pool.getConnection();

  try {
    const { serial_no, station_id, reason } = req.body;

    if (!serial_no?.trim() || !station_id) {
      return res.status(400).json({
        success: false,
        message: "serial_no and station_id are required.",
      });
    }

    await conn.beginTransaction();

    const user = await getUserContext(conn, req.user.id);

    if (!user.factory_id || !user.line_id) {
      throw Object.assign(
        new Error("User must be assigned to a factory and production line."),
        { status: 403 }
      );
    }

    const station = await getActiveStation(
      conn,
      station_id,
      user.factory_id,
      user.line_id
    );

    const item = await getProductionItem(
      conn,
      serial_no.trim(),
      user.factory_id,
      user.line_id
    );

    if (item.item_status === "REJECTED") {
      throw Object.assign(new Error("Rejected products cannot enter rework."), { status: 409 });
    }

    if (item.item_status === "REWORK") {
      throw Object.assign(new Error("This product is already under rework."), { status: 409 });
    }

    await conn.query(
      `UPDATE production_order_items
       SET status = 'REWORK',
           rework_station_id = ?,
           rework_started_at = NOW(),
           rework_started_by = ?
       WHERE id = ? AND status = 'ACTIVE'`,
      [station.id, user.id, item.item_id]
    );

    await conn.query(
      `UPDATE production
       SET status = 'REWORK', updated_at = NOW()
       WHERE serial_no = ?
         AND factory_id = ?
         AND line_id = ?
         AND status NOT IN ('REJECTED', 'COMPLETED')`,
      [item.serial_no, user.factory_id, user.line_id]
    );

    await conn.query(
      `INSERT INTO production_item_quality_history
       (production_order_item_id, action_type, rework_station_id,
        stage_id, reason, performed_by)
       VALUES (?, 'REWORK_STARTED', ?, ?, ?, ?)`,
      [
        item.item_id,
        station.id,
        user.stage_id || null,
        reason?.trim() || null,
        user.id,
      ]
    );

    await conn.commit();

    return res.json({
      success: true,
      message: "Product moved to rework successfully.",
      data: {
        serial_no: item.serial_no,
        production_order_id: item.production_order_id,
        station_id: station.id,
        station_name: station.name,
        status: "REWORK",
      },
    });
  } catch (error) {
    await conn.rollback();

    return res.status(error.status || 500).json({
      success: false,
      message: error.message,
    });
  } finally {
    conn.release();
  }
};

// ----------------------------------------------------
// POST /api/quality/rework/complete
// ----------------------------------------------------
export const completeRework = async (req, res) => {
  const conn = await pool.getConnection();

  try {
    const { serial_no, station_id, reason } = req.body;

    if (!serial_no?.trim() || !station_id) {
      return res.status(400).json({
        success: false,
        message: "serial_no and station_id are required.",
      });
    }

    await conn.beginTransaction();

    const user = await getUserContext(conn, req.user.id);

    if (!user.factory_id || !user.line_id) {
      throw Object.assign(
        new Error("User must be assigned to a factory and production line."),
        { status: 403 }
      );
    }

    const station = await getActiveStation(
      conn,
      station_id,
      user.factory_id,
      user.line_id
    );

    const item = await getProductionItem(
      conn,
      serial_no.trim(),
      user.factory_id,
      user.line_id
    );

    if (item.item_status !== "REWORK") {
      throw Object.assign(
        new Error("This product is not currently under rework."),
        { status: 409 }
      );
    }

    if (Number(item.rework_station_id) !== Number(station.id)) {
      throw Object.assign(
        new Error("This product is assigned to a different rework station."),
        { status: 403 }
      );
    }

    await conn.query(
      `UPDATE production_order_items
       SET status = 'ACTIVE',
           rework_station_id = NULL,
           rework_started_at = NULL,
           rework_started_by = NULL
       WHERE id = ? AND status = 'REWORK'`,
      [item.item_id]
    );

    await conn.query(
      `UPDATE production
       SET status = 'IN_PROGRESS', updated_at = NOW()
       WHERE serial_no = ?
         AND factory_id = ?
         AND line_id = ?
         AND status = 'REWORK'`,
      [item.serial_no, user.factory_id, user.line_id]
    );

    await conn.query(
      `INSERT INTO production_item_quality_history
       (production_order_item_id, action_type, rework_station_id,
        stage_id, reason, performed_by)
       VALUES (?, 'REWORK_COMPLETED', ?, ?, ?, ?)`,
      [
        item.item_id,
        station.id,
        user.stage_id || null,
        reason?.trim() || null,
        user.id,
      ]
    );

    await conn.commit();

    return res.json({
      success: true,
      message: "Rework completed. Product released to normal production.",
      data: {
        serial_no: item.serial_no,
        production_order_id: item.production_order_id,
        status: "ACTIVE",
        sequence_no: item.sequence_no,
      },
    });
  } catch (error) {
    await conn.rollback();

    return res.status(error.status || 500).json({
      success: false,
      message: error.message,
    });
  } finally {
    conn.release();
  }
};

// ----------------------------------------------------
// POST /api/quality/reject
// ----------------------------------------------------
export const rejectProduct = async (req, res) => {
  const conn = await pool.getConnection();

  try {
    const { serial_no, reason } = req.body;

    if (!serial_no?.trim()) {
      return res.status(400).json({
        success: false,
        message: "serial_no is required.",
      });
    }

    await conn.beginTransaction();

    const user = await getUserContext(conn, req.user.id);

    if (!user.factory_id || !user.line_id) {
      throw Object.assign(
        new Error("User must be assigned to a factory and production line."),
        { status: 403 }
      );
    }

    const item = await getProductionItem(
      conn,
      serial_no.trim(),
      user.factory_id,
      user.line_id
    );

    if (item.item_status === "REJECTED") {
      throw Object.assign(new Error("Product is already rejected."), { status: 409 });
    }

    await conn.query(
      `UPDATE production_order_items
       SET status = 'REJECTED',
           rejected_at = NOW(),
           rejected_by = ?,
           rework_station_id = NULL,
           rework_started_at = NULL,
           rework_started_by = NULL
       WHERE id = ?`,
      [user.id, item.item_id]
    );

    await conn.query(
      `UPDATE production
       SET status = 'REJECTED', updated_at = NOW()
       WHERE serial_no = ?
         AND factory_id = ?
         AND line_id = ?`,
      [item.serial_no, user.factory_id, user.line_id]
    );

    await conn.query(
      `INSERT INTO production_item_quality_history
       (production_order_item_id, action_type, stage_id, reason, performed_by)
       VALUES (?, 'REJECTED', ?, ?, ?)`,
      [
        item.item_id,
        user.stage_id || null,
        reason?.trim() || null,
        user.id,
      ]
    );

    await conn.commit();

    return res.json({
      success: true,
      message: "Product rejected permanently.",
      data: {
        serial_no: item.serial_no,
        production_order_id: item.production_order_id,
        status: "REJECTED",
      },
    });
  } catch (error) {
    await conn.rollback();

    return res.status(error.status || 500).json({
      success: false,
      message: error.message,
    });
  } finally {
    conn.release();
  }
};

// ----------------------------------------------------
// GET /api/quality/history/:serialNo
// ----------------------------------------------------
export const getQualityHistory = async (req, res) => {
  const conn = await pool.getConnection();

  try {
    const user = await getUserContext(conn, req.user.id);

    const [rows] = await conn.query(
      `SELECT
          qh.id,
          poi.serial_no,
          qh.action_type,
          rs.name AS rework_station,
          qh.stage_id,
          qh.reason,
          u.username AS performed_by,
          qh.created_at
       FROM production_item_quality_history qh
       INNER JOIN production_order_items poi
         ON poi.id = qh.production_order_item_id
       INNER JOIN production_orders po
         ON po.id = poi.production_order_id
       LEFT JOIN rework_stations rs
         ON rs.id = qh.rework_station_id
       LEFT JOIN users u
         ON u.id = qh.performed_by
       WHERE poi.serial_no = ?
         AND po.factory_id = ?
         AND po.line_id = ?
       ORDER BY qh.created_at DESC`,
      [req.params.serialNo, user.factory_id, user.line_id]
    );

    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message,
    });
  } finally {
    conn.release();
  }
};
