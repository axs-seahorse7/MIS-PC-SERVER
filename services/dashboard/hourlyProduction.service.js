
import { pool } from "../../DB/config/mysql.config.js";

const PERIODS = {
  0: { startHour: 0, endHour: 6, label: "12 AM - 6 AM" },
  1: { startHour: 6, endHour: 12, label: "6 AM - 12 PM" },
  2: { startHour: 12, endHour: 18, label: "12 PM - 6 PM" },
  3: { startHour: 18, endHour: 24, label: "6 PM - 12 AM" },
};

const formatHour = (hour) => {
  const suffix = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 || 12;
  return `${displayHour} ${suffix}`;
};

const isValidDate = (date) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
  new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

export const getHourlyProductionData = async (user, filters = {}) => {
  const date = filters.date;
  const periodIndex = Number(filters.period ?? 0);
  const factoryId = filters.factoryId
    ? Number(filters.factoryId)
    : null;

  if (!isValidDate(date)) {
    const error = new Error("Invalid date. Expected YYYY-MM-DD.");
    error.status = 400;
    throw error;
  }

  if (!Object.hasOwn(PERIODS, periodIndex)) {
    const error = new Error("Invalid period. Use 0, 1, 2, or 3.");
    error.status = 400;
    throw error;
  }

  if (factoryId !== null && (!Number.isInteger(factoryId) || factoryId <= 0)) {
    const error = new Error("Invalid factoryId.");
    error.status = 400;
    throw error;
  }

  const [userRows] = await pool.query(
    `SELECT id, factory_id FROM users WHERE id = ? LIMIT 1`,
    [user?.id]
  );

  if (!userRows.length) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }

  const isSystemAdmin = user?.role === "SYSTEM_ADMIN";
  const userFactoryId = userRows[0].factory_id;

  if (!isSystemAdmin && !userFactoryId) {
    const error = new Error("User is not assigned to a factory");
    error.status = 403;
    throw error;
  }

  if (!isSystemAdmin && factoryId && factoryId !== Number(userFactoryId)) {
    const error = new Error("You are not authorized to access this factory");
    error.status = 403;
    throw error;
  }

  const selectedFactoryId = isSystemAdmin
    ? factoryId
    : Number(userFactoryId);

  const { startHour, endHour, label } = PERIODS[periodIndex];

  const [lineRows] = await pool.query(
    `
    SELECT id, name
    FROM production_lines
    WHERE is_active = 1
      AND (? IS NULL OR factory_id = ?)
    ORDER BY name ASC
    `,
    [selectedFactoryId, selectedFactoryId]
  );

  if (!lineRows.length) {
    return {
      date,
      period: periodIndex,
      periodLabel: label,
      startHour,
      endHour,
      lines: [],
      totalProduced: 0,
    };
  }

  const [productionRows] = await pool.query(
    `
    SELECT
      sh.line_id,
      HOUR(sh.scanned_at) AS hour,
      COUNT(DISTINCT poi.id) AS produced_qty

    FROM scan_history sh

    INNER JOIN production_orders po
      ON po.id = sh.production_order_id

    INNER JOIN production_order_stages final_stage
      ON final_stage.production_order_id = po.id
      AND final_stage.stage_id = sh.stage_id
      AND final_stage.sequence_order = (
        SELECT MAX(pos2.sequence_order)
        FROM production_order_stages pos2
        WHERE pos2.production_order_id = po.id
      )

    LEFT JOIN customer_bindings cb
      ON cb.customer_qr = sh.scanned_value
      AND cb.production_order_id = sh.production_order_id

    INNER JOIN production_order_items poi
      ON poi.production_order_id = sh.production_order_id
      AND poi.serial_no = COALESCE(cb.pcb_qr, sh.scanned_value)

    WHERE sh.status = 'SUCCESS'
      AND sh.scanned_at >= ?
      AND sh.scanned_at < ?
      AND HOUR(sh.scanned_at) >= ?
      AND HOUR(sh.scanned_at) < ?
      AND (? IS NULL OR sh.factory_id = ?)

    GROUP BY
      sh.line_id,
      HOUR(sh.scanned_at)
    `,
    [
      `${date} ${String(startHour).padStart(2, "0")}:00:00`,
      endHour === 24
        ? `${getNextDate(date)} 00:00:00`
        : `${date} ${String(endHour).padStart(2, "0")}:00:00`,
      startHour,
      endHour,
      selectedFactoryId,
      selectedFactoryId,
    ]
  );

  const productionMap = new Map(
    productionRows.map((row) => [
      `${row.line_id}-${row.hour}`,
      Number(row.produced_qty),
    ])
  );

  const lines = lineRows.map((line) => {
    const hourlyData = Array.from(
      { length: 6 },
      (_, index) => {
        const hour = startHour + index;

        return {
          hour,
          label: formatHour(hour),
          quantity: productionMap.get(`${line.id}-${hour}`) || 0,
        };
      }
    );

    return {
      lineId: line.id,
      lineName: line.name,
      totalProduced: hourlyData.reduce(
        (sum, item) => sum + item.quantity,
        0
      ),
      hourlyData,
    };
  });

  return {
    date,
    period: periodIndex,
    periodLabel: label,
    startHour,
    endHour,
    lines,
    totalProduced: lines.reduce(
      (sum, line) => sum + line.totalProduced,
      0
    ),
  };
};

function getNextDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));

  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, "0"),
    String(next.getUTCDate()).padStart(2, "0"),
  ].join("-");
}
