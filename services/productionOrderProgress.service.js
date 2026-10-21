
import { pool } from "../DB/config/mysql.config.js";

export const getProductionOrderProgress = async (user, orderId) => {
  const [orders] = await pool.query(
    `SELECT
       po.id,
       po.order_no,
       po.factory_id,
       po.line_id,
       po.product_id,
       po.target_qty,
       po.status,
       po.started_at,
       po.completed_at,
       f.name AS factory_name,
       pl.name AS line_name,
       p.name AS product_name
     FROM production_orders po
     LEFT JOIN factories f ON f.id = po.factory_id
     LEFT JOIN production_lines pl ON pl.id = po.line_id
     LEFT JOIN products p ON p.id = po.product_id
     WHERE po.id = ?
     LIMIT 1`,
    [orderId]
  );

  if (!orders.length) {
    const error = new Error("Production order not found");
    error.status = 404;
    throw error;
  }

  const order = orders[0];
  const [users] = await pool.query(
    "SELECT factory_id FROM users WHERE id = ? LIMIT 1",
    [user?.id]
  );

  if (!users.length) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }

  if (
    user?.role !== "SYSTEM_ADMIN" &&
    Number(users[0].factory_id) !== Number(order.factory_id)
  ) {
    const error = new Error("Access denied for this production order");
    error.status = 403;
    throw error;
  }

  const [stages] = await pool.query(
    `SELECT
       pos.stage_id,
       pos.sequence_order,
       s.name AS stage_name,
       s.machine_code
     FROM production_order_stages pos
     JOIN stages s ON s.id = pos.stage_id
     WHERE pos.production_order_id = ?
     ORDER BY pos.sequence_order ASC`,
    [orderId]
  );

  const [counts] = await pool.query(
    `SELECT
       sh.stage_id,
       COUNT(DISTINCT COALESCE(cb.pcb_qr, sh.scanned_value))
         AS scanned_qty,
       MAX(sh.scanned_at) AS last_scanned_at
     FROM scan_history sh
     LEFT JOIN customer_bindings cb
       ON cb.customer_qr = sh.scanned_value
       AND cb.production_order_id = sh.production_order_id
     WHERE sh.production_order_id = ?
       AND sh.status = 'SUCCESS'
     GROUP BY sh.stage_id`,
    [orderId]
  );

  const countByStage = new Map(
    counts.map((row) => [
      Number(row.stage_id),
      {
        scannedQty: Number(row.scanned_qty || 0),
        lastScannedAt: row.last_scanned_at,
      },
    ])
  );

  const stageProgress = stages.map((stage) => ({
    stageId: stage.stage_id,
    sequenceOrder: stage.sequence_order,
    stageName: stage.stage_name,
    machineCode: stage.machine_code,
    scannedQty: countByStage.get(Number(stage.stage_id))?.scannedQty || 0,
    lastScannedAt:
      countByStage.get(Number(stage.stage_id))?.lastScannedAt || null,
  }));

  const finalStage = stageProgress.at(-1);
  const targetQty = Number(order.target_qty || 0);
  const achievedQty = finalStage?.scannedQty || 0;
  const remainingQty = Math.max(targetQty - achievedQty, 0);

  return {
    success: true,
    data: {
      order,
      targetQty,
      achievedQty,
      remainingQty,
      completionPercentage: targetQty
        ? Number(Math.min((achievedQty / targetQty) * 100, 100).toFixed(2))
        : 0,
      stages: stageProgress,
    },
  };
};
