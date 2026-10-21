
import { pool } from "../DB/config/mysql.config.js";

const requireAdmin = async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
    return false;
  }

  const [users] = await pool.query(
    "SELECT role FROM users WHERE id = ? LIMIT 1",
    [userId]
  );

  if (
    !users.length ||
    !["ADMIN", "SYSTEM_ADMIN"].includes(users[0].role)
  ) {
    res.status(403).json({
      success: false,
      message: "Admin access required.",
    });
    return false;
  }

  return true;
};

const classifyMachine = (row) => {
  const identity = `${row.machine_code || ""} ${
    row.machine_name || ""
  }`.toUpperCase();

  if (identity.includes("FCT")) return "FCT";
  if (identity.includes("ICT")) return "ICT";
  return "OTHER";
};

const sortChronologically = (rows) =>
  rows.sort((a, b) => {
    const timeA = new Date(a.attempted_at || 0).getTime();
    const timeB = new Date(b.attempted_at || 0).getTime();

    return (
      timeA - timeB ||
      Number(a.id || 0) - Number(b.id || 0)
    );
  });


async function getSerialHistory(serialInput) {
  // Resolve internal PCB QR or customer QR.
  const [bindings] = await pool.query(
    `SELECT pcb_qr, customer_qr, production_order_id
     FROM customer_bindings
     WHERE pcb_qr = ? OR customer_qr = ?
     LIMIT 1`,
    [serialInput, serialInput]
  );

  const binding = bindings[0] || null;
  const serial = binding?.pcb_qr || serialInput;
  const customerQr = binding?.customer_qr || null;

  // Return every production record, not just the newest one.
  // Names/codes are for display; IDs remain available for relationships.
  const [productions] = await pool.query(
    `SELECT
       p.id AS production_record_id,
       p.serial_no,
       p.product_id,
       pr.name AS product_name,
       pr.part_code AS product_code,
       pr.erp_no AS product_erp_no,
       p.factory_id,
       fa.name AS factory_name,
       fa.code AS factory_code,
       p.line_id,
       pl.name AS line_name,
       pl.code AS line_code,
       p.current_stage_id,
       st.name AS current_stage_name,
       p.current_sequence_no,
       p.status,
       p.created_at,
       p.updated_at,
       p.completed_at,
       p.packed_at,
       p.dispatched_at
     FROM production p
     LEFT JOIN products pr ON pr.id = p.product_id
     LEFT JOIN factories fa ON fa.id = p.factory_id
     LEFT JOIN production_lines pl ON pl.id = p.line_id
     LEFT JOIN stages st ON st.id = p.current_stage_id
     WHERE p.serial_no = ?
     ORDER BY p.created_at ASC, p.id ASC`,
    [serial]
  );

  // Include PO details and the product/line context of each order.
  const [orderItems] = await pool.query(
    `SELECT
       poi.serial_no,
       poi.sequence_no AS production_sequence,
       poi.status AS item_status,
       poi.rejected_at,
       po.id AS production_order_id,
       po.order_no AS production_order_no,
       po.status AS production_order_status,
       po.product_id,
       pr.name AS product_name,
       pr.part_code AS product_code,
       po.factory_id,
       fa.name AS factory_name,
       fa.code AS factory_code,
       po.line_id,
       pl.name AS line_name,
       pl.code AS line_code
     FROM production_order_items poi
     JOIN production_orders po
       ON po.id = poi.production_order_id
     LEFT JOIN products pr ON pr.id = po.product_id
     LEFT JOIN factories fa ON fa.id = po.factory_id
     LEFT JOIN production_lines pl ON pl.id = po.line_id
     WHERE poi.serial_no = ?
     ORDER BY po.id ASC`,
    [serial]
  );

  const orderIds = [
    ...new Set([
      ...orderItems.map((row) => Number(row.production_order_id)),
      ...(binding?.production_order_id
        ? [Number(binding.production_order_id)]
        : []),
    ]),
  ];

  // Fetch actual scans of this serial/customer QR.
  // Do not fetch every PCB scan belonging to the same production order.
  const scanValues = [
    ...new Set([serial, customerQr].filter(Boolean)),
  ];

  let scans = [];

  if (scanValues.length) {
    const placeholders = scanValues.map(() => "?").join(",");

    const [rows] = await pool.query(
      `SELECT
         sh.id,
         sh.scanned_value,
         sh.production_order_id,
         sh.sequence_no,
         sh.status,
         sh.remarks,
         sh.group_id,
         sh.scanned_at,
         sh.factory_id,
         fa.name AS factory_name,
         sh.line_id,
         pl.name AS line_name,
         pl.code AS line_code,
         sh.stage_id,
         st.name AS stage_name,
         st.machine_code,
         u.username AS scanned_by,
         po.order_no AS production_order_no
       FROM scan_history sh
       LEFT JOIN factories fa ON fa.id = sh.factory_id
       LEFT JOIN production_lines pl ON pl.id = sh.line_id
       LEFT JOIN stages st ON st.id = sh.stage_id
       LEFT JOIN users u ON u.id = sh.user_id
       LEFT JOIN production_orders po
         ON po.id = sh.production_order_id
       WHERE sh.scanned_value IN (${placeholders})
       ORDER BY sh.scanned_at ASC, sh.id ASC`,
      scanValues
    );

    scans = rows;
  }

  // The current configuration stores external machine results in ict_results.
  // Preserve every row: repeated attempts are important for failure analysis.
  const [ictResults] = await pool.query(
    `SELECT
       id,
       serial_no,
       program,
       result,
       machine_name,
       machine_code,
       imported_at
     FROM ict_results
     WHERE serial_no = ?
     ORDER BY imported_at ASC, id ASC`,
    [serial]
  );

  // Preserve compatibility with the legacy FCT table if it contains data.
  const [fctResults] = await pool.query(
    `SELECT
       id,
       line_code,
       mo_lot_no,
       rail,
       sn_code,
       station_code,
       surface,
       results,
       status,
       created_at,
       updated_at
     FROM fct_results
     WHERE sn_code = ?
     ORDER BY created_at ASC, id ASC`,
    [serial]
  );

  const sharedAttempts = ictResults.map((row) => ({
    ...row,
    source_table: "ict_results",
    machine_type: classifyMachine(row),
    attempted_at: row.imported_at,
  }));

  const legacyFctAttempts = fctResults.map((row) => ({
    ...row,
    serial_no: row.sn_code,
    machine_code: row.station_code || row.line_code || null,
    machine_name: row.station_code || row.line_code || "FCT",
    result: row.status,
    source_table: "fct_results",
    machine_type: "FCT",
    attempted_at: row.created_at,
  }));

  const allAttempts = sortChronologically([
    ...sharedAttempts,
    ...legacyFctAttempts,
  ]);

  const ictAttempts = allAttempts.filter(
    (row) =>
      row.source_table === "ict_results" &&
      row.machine_type === "ICT"
  );

  const fctAttempts = allAttempts.filter(
    (row) => row.machine_type === "FCT"
  );

  const failuresByMachine = {};

  for (const row of allAttempts) {
    const key = `${row.machine_code || "UNKNOWN"}|${
      row.machine_name || "Unknown machine"
    }`;

    if (!failuresByMachine[key]) {
      failuresByMachine[key] = {
        machine_code: row.machine_code || null,
        machine_name: row.machine_name || "Unknown machine",
        attempts: 0,
        failures: 0,
        passes: 0,
      };
    }

    const summary = failuresByMachine[key];
    summary.attempts += 1;

    const result = String(row.result || "").toUpperCase();

    if (result === "FAIL") summary.failures += 1;
    if (result === "PASS") summary.passes += 1;
  }

  const [boxRows] = await pool.query(
    `SELECT
       b.id,
       b.box_code,
       b.status,
       b.box_size,
       b.actual_quantity,
       b.created_at,
       b.packed_at,
       b.closed_at,
       bi.packed_at AS pcb_packed_at
     FROM box_items bi
     JOIN boxes b ON b.id = bi.box_id
     WHERE bi.serial_no = ?
     ORDER BY b.id DESC`,
    [serial]
  );

  const countFailures = (rows) =>
    rows.filter(
      (row) => String(row.result || "").toUpperCase() === "FAIL"
    ).length;

  const countPasses = (rows) =>
    rows.filter(
      (row) => String(row.result || "").toUpperCase() === "PASS"
    ).length;

  const totalFailures = countFailures(allAttempts);

  return {
    serial_no: serial,
    searched_value: serialInput,
    customer_qr: customerQr,

    // Backward compatibility for the current frontend.
    production: productions[productions.length - 1] || null,

    // New fields for the improved traceability UI.
    productions,
    production_orders: orderItems,
    scan_history: scans,

    machine_tests: {
      attempts: allAttempts,
      ict: ictAttempts,
      fct: fctAttempts,
      failures_by_machine: Object.values(failuresByMachine),
    },

    failure_summary: {
      ict_failures: countFailures(ictAttempts),
      fct_failures: countFailures(fctAttempts),
      other_machine_failures: allAttempts.filter(
        (row) =>
          row.machine_type === "OTHER" &&
          String(row.result || "").toUpperCase() === "FAIL"
      ).length,
      total_recorded_machine_failures: totalFailures,
      total_attempts: allAttempts.length,
      total_passes: countPasses(allAttempts),
      note:
        "Every recorded machine-result row is preserved. Deleted scan-history records cannot be reconstructed from this table.",
    },

    boxes: boxRows,
  };
}


export const searchSerialHistory = async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const serial = String(req.query.serial || "").trim();

    if (!serial) {
      return res.status(400).json({
        success: false,
        message: "Provide a serial query parameter.",
      });
    }

    if (serial.length > 255) {
      return res.status(400).json({
        success: false,
        message: "Search value is too long.",
      });
    }

    const data = await getSerialHistory(serial);

    const found =
      Boolean(data.production) ||
      data.production_orders.length > 0 ||
      data.scan_history.length > 0 ||
      data.machine_tests.attempts.length > 0 ||
      data.boxes.length > 0 ||
      Boolean(data.customer_qr);

    return res.status(found ? 200 : 404).json({
      success: found,
      message: found
        ? "Serial traceability retrieved."
        : "No traceability records found for this value.",
      data,
    });
  } catch (error) {
    console.error("Serial history search failed:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve serial history.",
    });
  }
};

export const searchBoxHistory = async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const boxCode = String(req.query.boxCode || "").trim();

    if (!boxCode) {
      return res.status(400).json({
        success: false,
        message: "Provide a boxCode query parameter.",
      });
    }

    const [boxes] = await pool.query(
      `SELECT
         b.id,
         b.box_code,
         b.product_id,
         p.name AS product_name,
         b.packaging_stage_id,
         s.name AS packaging_stage_name,
         b.box_size,
         b.actual_quantity,
         b.status,
         b.barcode_data,
         b.created_at,
         b.packed_at,
         b.closed_at
       FROM boxes b
       LEFT JOIN products p ON p.id = b.product_id
       LEFT JOIN stages s ON s.id = b.packaging_stage_id
       WHERE b.box_code = ?
       LIMIT 1`,
      [boxCode]
    );

    if (!boxes.length) {
      return res.status(404).json({
        success: false,
        message: "Box not found.",
      });
    }

    const box = boxes[0];

    const [items] = await pool.query(
      `SELECT serial_no, packed_at
       FROM box_items
       WHERE box_id = ?
       ORDER BY packed_at ASC, id ASC`,
      [box.id]
    );

    const pcbHistories = [];

    for (const item of items) {
      pcbHistories.push(
        await getSerialHistory(item.serial_no)
      );
    }

    return res.status(200).json({
      success: true,
      message: "Box traceability retrieved.",
      data: {
        box,
        item_count: items.length,
        items: items.map((item) => ({
          ...item,
          history: pcbHistories.find(
            (history) => history.serial_no === item.serial_no
          ),
        })),
      },
    });
  } catch (error) {
    console.error("Box history search failed:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve box history.",
    });
  }
};
