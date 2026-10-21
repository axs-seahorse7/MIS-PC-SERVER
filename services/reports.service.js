
import { pool } from "../DB/config/mysql.config.js";

export const getProductionSummaryData = async (user, filters) => {
  const {
    factoryId,
    lineId,
    productId,
    productionOrderId,
    from,
    to,
  } = filters;

  const [userRows] = await pool.query(
    `SELECT id, factory_id FROM users WHERE id = ? LIMIT 1`,
    [user?.id]
  );

  if (!userRows.length) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }

  const userFactoryId = userRows[0].factory_id;
  const isSystemAdmin = user?.role === "SYSTEM_ADMIN";

  if (!isSystemAdmin && !userFactoryId) {
    const error = new Error(
      "User is not assigned to a factory"
    );
    error.status = 403;
    throw error;
  }

  const conditions = [];
  const params = [];

  if (!isSystemAdmin) {
    conditions.push("po.factory_id = ?");
    params.push(userFactoryId);
  }

  if (factoryId) {
    conditions.push("po.factory_id = ?");
    params.push(Number(factoryId));
  }

  if (lineId) {
    conditions.push("po.line_id = ?");
    params.push(Number(lineId));
  }

  if (productId) {
    conditions.push("po.product_id = ?");
    params.push(Number(productId));
  }

  if (productionOrderId) {
    conditions.push("po.id = ?");
    params.push(Number(productionOrderId));
  }

  if (from) {
    conditions.push("po.planned_date >= ?");
    params.push(from);
  }

  if (to) {
    conditions.push("po.planned_date < DATE_ADD(?, INTERVAL 1 DAY)");
    params.push(to);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const [rows] = await pool.query(
    `
    SELECT
      po.id AS production_order_id,
      po.order_no,
      po.factory_id,
      f.name AS factory_name,
      po.line_id,
      pl.name AS line_name,
      po.product_id,
      p.name AS product_name,
      p.erp_no AS product_erp_no,
      po.target_qty,

      COALESCE(progress.achieved_qty, 0) AS achieved_qty,

      GREATEST(
        po.target_qty - COALESCE(progress.achieved_qty, 0),
        0
      ) AS remaining_qty,

      ROUND(
        LEAST(
          COALESCE(progress.achieved_qty, 0)
            / NULLIF(po.target_qty, 0) * 100,
          100
        ),
        2
      ) AS completion_percentage,

      po.status AS production_order_status,
      po.planned_date,
      po.started_at,
      po.completed_at,
      final_stage.stage_id AS final_stage_id,
      final_stage.sequence_order AS final_stage_sequence

    FROM production_orders po

    LEFT JOIN factories f
      ON f.id = po.factory_id

    LEFT JOIN production_lines pl
      ON pl.id = po.line_id

    LEFT JOIN products p
      ON p.id = po.product_id

    LEFT JOIN production_order_stages final_stage
      ON final_stage.production_order_id = po.id
      AND final_stage.sequence_order = (
        SELECT MAX(pos2.sequence_order)
        FROM production_order_stages pos2
        WHERE pos2.production_order_id = po.id
      )

    LEFT JOIN (
      SELECT
        sh.production_order_id,
        sh.stage_id,
        COUNT(
          DISTINCT COALESCE(cb.pcb_qr, sh.scanned_value)
        ) AS achieved_qty

      FROM scan_history sh

      LEFT JOIN customer_bindings cb
        ON cb.customer_qr = sh.scanned_value
        AND cb.production_order_id = sh.production_order_id

      WHERE sh.status = 'SUCCESS'
        AND sh.production_order_id IS NOT NULL

      GROUP BY
        sh.production_order_id,
        sh.stage_id
    ) progress
      ON progress.production_order_id = po.id
      AND progress.stage_id = final_stage.stage_id

    ${whereClause}

    ORDER BY po.planned_date DESC, po.id DESC
    `,
    params
  );

  const summary = rows.reduce(
    (result, row) => {
      result.orderCount += 1;
      result.targetQty += Number(row.target_qty) || 0;
      result.achievedQty += Number(row.achieved_qty) || 0;
      result.remainingQty += Number(row.remaining_qty) || 0;
      return result;
    },
    {
      orderCount: 0,
      targetQty: 0,
      achievedQty: 0,
      remainingQty: 0,
    }
  );

  summary.completionPercentage = summary.targetQty
    ? Number(
        Math.min(
          (summary.achievedQty / summary.targetQty) * 100,
          100
        ).toFixed(2)
      )
    : 0;

  return {
    success: true,
    summary,
    count: rows.length,
    data: rows,
  };
};
