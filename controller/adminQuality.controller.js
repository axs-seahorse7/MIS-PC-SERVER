import { pool } from "../DB/config/mysql.config.js";

const requireAdmin = (req, res) => {
  if (!["ADMIN", "SYSTEM_ADMIN"].includes(req.user?.role)) {
    res.status(403).json({
      success: false,
      message: "Only Admin can access Quality Control.",
    });
    return false;
  }

  return true;
};

// GET /api/quality/items
export const getQualityItems = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.pageSize, 10) || 10)
    );
    const offset = (page - 1) * pageSize;

    const { status, factory_id, line_id, search } = req.query;

    const filters = [];
    const params = [];

    if (factory_id) {
      filters.push("pl.factory_id = ?");
      params.push(Number(factory_id));
    }

    if (line_id) {
      filters.push("po.line_id = ?");
      params.push(Number(line_id));
    }

    if (search?.trim()) {
      filters.push(`
        (
          poi.serial_no LIKE ?
          OR po.order_no LIKE ?
          OR p.name LIKE ?
        )
      `);

      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    const baseWhere = filters.length
      ? `WHERE ${filters.join(" AND ")}`
      : "";

    const validStatuses = ["REWORK", "PENDING_QA", "REJECTED"];

    const selectedStatus = validStatuses.includes(status)
      ? status
      : null;

    const listWhere = selectedStatus
    ? `${baseWhere}${baseWhere ? " AND" : " WHERE"} poi.status = ?`
    : `${baseWhere}${baseWhere ? " AND" : " WHERE"}
        poi.status IN ('REWORK', 'PENDING_QA', 'REJECTED')`;

    // KPI counts are independent of the selected status card.
    const [countRows] = await pool.query(
      `
      SELECT poi.status, COUNT(*) AS total
      FROM production_order_items poi
      INNER JOIN production_orders po
        ON po.id = poi.production_order_id
      INNER JOIN production_lines pl
        ON pl.id = po.line_id
      INNER JOIN products p
        ON p.id = po.product_id
      ${baseWhere}
      GROUP BY poi.status
      `,
      params
    );

    const counts = {
      REWORK: 0,
      PENDING_QA: 0,
      REJECTED: 0,
    };

    countRows.forEach((row) => {
      if (Object.hasOwn(counts, row.status)) {
        counts[row.status] = Number(row.total);
      }
    });

    const listParams = selectedStatus
      ? [...params, selectedStatus]
      : [...params];

    const [items] = await pool.query(
      `
      SELECT
        poi.id,
        poi.serial_no,
        poi.customer_qr_code,
        poi.sequence_no,
        poi.status,
        poi.rejected_at,
        poi.rework_started_at,
        poi.rework_submitted_at,
        poi.qa_reviewed_at,

        po.id AS production_order_id,
        po.order_no,

        p.name AS product_name,

        pl.id AS line_id,
        pl.name AS line_name,

        f.id AS factory_id,
        f.name AS factory_name,

        rs.name AS rework_station_name,

        submitter.username AS rework_submitted_by,
        reviewer.username AS qa_reviewed_by

      FROM production_order_items poi

      INNER JOIN production_orders po
        ON po.id = poi.production_order_id

      INNER JOIN production_lines pl
        ON pl.id = po.line_id

      INNER JOIN factories f
        ON f.id = pl.factory_id

      INNER JOIN products p
        ON p.id = po.product_id

      LEFT JOIN rework_stations rs
        ON rs.id = poi.rework_station_id

      LEFT JOIN users submitter
        ON submitter.id = poi.rework_completed_by

      LEFT JOIN users reviewer
        ON reviewer.id = poi.qa_reviewed_by

      ${listWhere}

      ORDER BY
        CASE poi.status
          WHEN 'PENDING_QA' THEN 1
          WHEN 'REWORK' THEN 2
          WHEN 'REJECTED' THEN 3
          ELSE 4
        END,
        COALESCE(
          poi.rework_submitted_at,
          poi.rework_started_at,
          poi.rejected_at,
          poi.created_at
        ) DESC

      LIMIT ? OFFSET ?
      `,
      [...listParams, pageSize, offset]
    );

    const [totalRows] = await pool.query(
      `
      SELECT COUNT(*) AS total
      FROM production_order_items poi
      INNER JOIN production_orders po
        ON po.id = poi.production_order_id
      INNER JOIN production_lines pl
        ON pl.id = po.line_id
      INNER JOIN products p
        ON p.id = po.product_id
      ${listWhere}
      `,
      listParams
    );

    const total = Number(totalRows[0]?.total || 0);

    return res.json({
      success: true,
      data: {
        counts,
        items,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      },
    });
  } catch (error) {
    console.error("GET QUALITY ITEMS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch Quality Control records.",
    });
  }
};