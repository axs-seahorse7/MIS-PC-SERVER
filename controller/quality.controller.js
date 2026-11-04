
import { pool } from "../DB/config/mysql.config.js";

const isAdmin = (user) => ["SYSTEM_ADMIN", "ADMIN"].includes(user?.role);

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
    const user = await getUserContext(pool, req.user.id);

    const admin = isAdmin(req.user);
    const { factory_id, line_id, active_only } = req.query;

    let sql = `
      SELECT
        rs.id,
        rs.factory_id,
        f.name AS factory_name,
        rs.line_id,
        pl.name AS line_name,
        rs.name,
        rs.code,
        rs.description,
        rs.is_active,
        rs.created_at,
        rs.updated_at
      FROM rework_stations rs
      INNER JOIN factories f ON f.id = rs.factory_id
      INNER JOIN production_lines pl ON pl.id = rs.line_id
      WHERE 1 = 1
    `;

    const params = [];

    if (!admin) {
      sql += ` AND rs.factory_id = ? AND rs.line_id = ? AND rs.is_active = 1`;
      params.push(user.factory_id, user.line_id);
    } else {
      if (factory_id) {
        sql += ` AND rs.factory_id = ?`;
        params.push(factory_id);
      }

      if (line_id) {
        sql += ` AND rs.line_id = ?`;
        params.push(line_id);
      }

      if (active_only === "true") {
        sql += ` AND rs.is_active = 1`;
      }
    }

    sql += ` ORDER BY f.name, pl.name, rs.name`;

    const [rows] = await pool.query(sql, params);

    return res.json({ success: true, data: rows });
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
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only Admin can create rework stations.",
      });
    }

    const { factory_id, line_id, name, code, description } = req.body;

    if (!factory_id || !line_id || !name?.trim() || !code?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Factory, Line, Name and Code are required.",
      });
    }

    const [lines] = await pool.query(
      `SELECT id FROM production_lines
       WHERE id = ? AND factory_id = ? AND is_active = 1`,
      [line_id, factory_id]
    );

    if (!lines.length) {
      return res.status(400).json({
        success: false,
        message: "Selected production line is invalid or inactive.",
      });
    }

    const [result] = await pool.query(
      `INSERT INTO rework_stations
       (factory_id, line_id, name, code, description, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        factory_id,
        line_id,
        name.trim(),
        code.trim().toUpperCase(),
        description?.trim() || null,
        req.user.id,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Rework station created successfully.",
      data: { id: result.insertId },
    });
  } catch (error) {
    const duplicate = error.code === "ER_DUP_ENTRY";

    return res.status(duplicate ? 409 : 500).json({
      success: false,
      message: duplicate
        ? "Station name or code already exists on this line."
        : error.message,
    });
  }
};

export const updateReworkStation = async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only Admin can update rework stations.",
      });
    }

    const { id } = req.params;
    const { factory_id, line_id, name, code, description } = req.body;

    if (!factory_id || !line_id || !name?.trim() || !code?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Factory, Line, Name and Code are required.",
      });
    }

    const [lines] = await pool.query(
      `SELECT id FROM production_lines
       WHERE id = ? AND factory_id = ?`,
      [line_id, factory_id]
    );

    if (!lines.length) {
      return res.status(400).json({
        success: false,
        message: "Selected line does not belong to this factory.",
      });
    }

    const [result] = await pool.query(
      `UPDATE rework_stations
       SET factory_id = ?,
           line_id = ?,
           name = ?,
           code = ?,
           description = ?
       WHERE id = ?`,
      [
        factory_id,
        line_id,
        name.trim(),
        code.trim().toUpperCase(),
        description?.trim() || null,
        id,
      ]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: "Rework station not found.",
      });
    }

    return res.json({
      success: true,
      message: "Rework station updated successfully.",
    });
  } catch (error) {
    return res.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({
      success: false,
      message: error.code === "ER_DUP_ENTRY"
        ? "Station name or code already exists on this line."
        : error.message,
    });
  }
};

export const updateReworkStationStatus = async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only Admin can change station status.",
      });
    }

    const { id } = req.params;
    const { is_active } = req.body;

    if (![0, 1, true, false].includes(is_active)) {
      return res.status(400).json({
        success: false,
        message: "is_active must be 0 or 1.",
      });
    }

    const [result] = await pool.query(
      `UPDATE rework_stations SET is_active = ? WHERE id = ?`,
      [is_active ? 1 : 0, id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: "Rework station not found.",
      });
    }

    return res.json({
      success: true,
      message: "Station status updated successfully.",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
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
