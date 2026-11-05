import { pool } from "../../DB/config/mysql.config.js";

const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export const getDashboardOverview = async (user, filters = {}) => {
  const { date, factoryId } = filters;

  if (!isValidDate(date)) {
    const error = new Error("A valid date (YYYY-MM-DD) is required.");
    error.status = 400;
    throw error;
  }

  const [users] = await pool.query(
    `SELECT id, factory_id, role
     FROM users
     WHERE id = ?
     LIMIT 1`,
    [user?.id]
  );

  if (!users.length) {
    const error = new Error("User not found.");
    error.status = 404;
    throw error;
  }

  const currentUser = users[0];
  const isSystemAdmin = currentUser.role === "SYSTEM_ADMIN";

  let selectedFactoryId = null;

  if (isSystemAdmin) {
    selectedFactoryId = factoryId ? Number(factoryId) : null;
  } else {
    if (!currentUser.factory_id) {
      const error = new Error("User is not assigned to a factory.");
      error.status = 403;
      throw error;
    }

    selectedFactoryId = Number(currentUser.factory_id);

    if (
      factoryId &&
      Number(factoryId) !== selectedFactoryId
    ) {
      const error = new Error("Access denied for this factory.");
      error.status = 403;
      throw error;
    }
  }

  const targetConditions = ["pt.target_date = ?"];
  const targetParams = [date];

  const productionConditions = [
    "sh.scanned_at >= ?",
    "sh.scanned_at < DATE_ADD(?, INTERVAL 1 DAY)",
    "sh.status = 'SUCCESS'",
    "poi.status = 'ACTIVE'",
  ];

  const productionParams = [date, date];

  if (selectedFactoryId) {
    targetConditions.push("pt.factory_id = ?");
    productionConditions.push("po.factory_id = ?");

    targetParams.push(selectedFactoryId);
    productionParams.push(selectedFactoryId);
  }

  // Query 1: Daily production target
  const [targetRows] = await pool.query(
    `
    SELECT COALESCE(SUM(pt.target_quantity), 0) AS target_qty
    FROM production_targets pt
    WHERE ${targetConditions.join(" AND ")}
    `,
    targetParams
  );

  // Query 2: Unique serials completed at their PO's final stage
  const [productionRows] = await pool.query(
    `
    SELECT COUNT(*) AS produced_qty
    FROM (
      SELECT DISTINCT poi.id
      FROM production_order_items poi

      INNER JOIN production_orders po
        ON po.id = poi.production_order_id

      INNER JOIN production_order_stages final_stage
        ON final_stage.production_order_id = po.id
        AND final_stage.sequence_order = (
          SELECT MAX(pos2.sequence_order)
          FROM production_order_stages pos2
          WHERE pos2.production_order_id = po.id
        )

      INNER JOIN scan_history sh
        ON sh.production_order_id = po.id
        AND sh.stage_id = final_stage.stage_id

      WHERE ${productionConditions.join(" AND ")}

        AND (
          sh.scanned_value = poi.serial_no

          OR EXISTS (
            SELECT 1
            FROM customer_bindings cb
            WHERE cb.production_order_id = po.id
              AND cb.pcb_qr = poi.serial_no
              AND cb.customer_qr = sh.scanned_value
          )
        )
    ) completed_items
    `,
    productionParams
  );

  const targetQty = Number(targetRows[0]?.target_qty || 0);
  const producedQty = Number(productionRows[0]?.produced_qty || 0);

  return {
    success: true,
    data: {
      date,
      targetQty,
      producedQty,
      remainingQty: Math.max(targetQty - producedQty, 0),
      achievementPercentage: targetQty
        ? Number(((producedQty / targetQty) * 100).toFixed(2))
        : 0,
    },
  };
};