
import { pool } from "../DB/config/mysql.config.js";



async function getSerialOrderOptions(serialInput) {
  // Resolve internal PCB QR or customer QR.
  const [bindings] = await pool.query(
    `SELECT pcb_qr, customer_qr
     FROM customer_bindings
     WHERE pcb_qr = ? OR customer_qr = ?
     LIMIT 1`,
    [serialInput, serialInput]
  );

  const binding = bindings[0] || null;
  const serial = binding?.pcb_qr || serialInput;

  const [orders] = await pool.query(
    `SELECT
       poi.id AS production_order_item_id,
       poi.serial_no,
       poi.status AS item_status,
       poi.sequence_no,
       po.id AS production_order_id,
       po.order_no AS production_order_no,
       po.status AS production_order_status,
       po.product_id,
       pr.name AS product_name,
       pr.part_code AS product_code,
       pr.erp_no AS product_erp_no,
       po.factory_id,
       fa.name AS factory_name,
       po.line_id,
       pl.name AS line_name
     FROM production_order_items poi
     INNER JOIN production_orders po
       ON po.id = poi.production_order_id
     LEFT JOIN products pr
       ON pr.id = po.product_id
     LEFT JOIN factories fa
       ON fa.id = po.factory_id
     LEFT JOIN production_lines pl
       ON pl.id = po.line_id
     WHERE poi.serial_no = ?
     ORDER BY po.id DESC`,
    [serial]
  );

  return {
    serial_no: serial,
    searched_value: serialInput,
    customer_qr: binding?.customer_qr || null,
    production_orders: orders,
  };
}


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


async function getSerialHistory(serialInput, productionOrderId) {
  // ------------------------------------------------------------
  // 1. Resolve internal PCB QR or customer QR
  // ------------------------------------------------------------

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

  // ------------------------------------------------------------
  // 2. Validate that the serial belongs to the selected PO
  // ------------------------------------------------------------

  const [orderItems] = await pool.query(
    `SELECT
       poi.id AS production_order_item_id,
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
     INNER JOIN production_orders po
       ON po.id = poi.production_order_id
     LEFT JOIN products pr ON pr.id = po.product_id
     LEFT JOIN factories fa ON fa.id = po.factory_id
     LEFT JOIN production_lines pl ON pl.id = po.line_id
     WHERE poi.serial_no = ?
       AND poi.production_order_id = ?
     ORDER BY poi.id ASC`,
    [serial, productionOrderId]
  );

  if (!orderItems.length) {
    return null;
  }

  const selectedOrder = orderItems[0];

  // ------------------------------------------------------------
  // 3. Fetch scans belonging ONLY to the selected PO
  // ------------------------------------------------------------

  const scanValues = [
    ...new Set([serial, customerQr].filter(Boolean)),
  ];

  let scans = [];

  if (scanValues.length) {
    const placeholders = scanValues.map(() => "?").join(",");

    const [scanRows] = await pool.query(
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
         u.name AS scanned_by_name,
         u.line_name AS operator_line_name,
         po.order_no AS production_order_no
       FROM scan_history sh
       LEFT JOIN factories fa ON fa.id = sh.factory_id
       LEFT JOIN production_lines pl ON pl.id = sh.line_id
       LEFT JOIN stages st ON st.id = sh.stage_id
       LEFT JOIN users u ON u.id = sh.user_id
       LEFT JOIN production_orders po
         ON po.id = sh.production_order_id
       WHERE sh.scanned_value IN (${placeholders})
         AND sh.production_order_id = ?
       ORDER BY sh.scanned_at ASC, sh.id ASC`,
      [...scanValues, productionOrderId]
    );

    scans = scanRows;
  }

  // ------------------------------------------------------------
  // 4. Fetch configured production route for selected PO product
  // ------------------------------------------------------------

  let configuredStageFlow = [];

  if (selectedOrder.product_id) {
    const [flowRows] = await pool.query(
      `SELECT
         psf.product_id,
         psf.sequence_no,
         psf.stage_id,
         psf.is_external_dependency,
         psf.external_machine_type,
         st.machine_code,
         st.name AS stage_name,
         st.description AS stage_description
       FROM product_stage_flow psf
       INNER JOIN stages st
         ON st.id = psf.stage_id
       WHERE psf.product_id = ?
       ORDER BY psf.sequence_no ASC`,
      [selectedOrder.product_id]
    );

    configuredStageFlow = flowRows;
  }

  // ------------------------------------------------------------
  // 5. Identify configured external machines dynamically
  // ------------------------------------------------------------

  const configuredMachineCodes = [
    ...new Set(
      configuredStageFlow
        .filter(
          (stage) =>
            Number(stage.is_external_dependency) === 1
        )
        .map((stage) =>
          String(stage.machine_code || "").trim()
        )
        .filter(Boolean)
    ),
  ];

  // ------------------------------------------------------------
  // 6. Fetch external machine results from the central ict_results
  //    table. Only configured machine codes are included.
  // ------------------------------------------------------------

  let externalMachineResults = [];

  if (configuredMachineCodes.length) {
    const placeholders = configuredMachineCodes
      .map(() => "?")
      .join(",");

    const [machineRows] = await pool.query(
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
         AND machine_code IN (${placeholders})
       ORDER BY imported_at ASC, id ASC`,
      [serial, ...configuredMachineCodes]
    );

    externalMachineResults = machineRows;
  }

  const externalMachineAttempts = externalMachineResults.map((row) => {
    const configuredStage = configuredStageFlow.find(
      (stage) =>
        Number(stage.is_external_dependency) === 1 &&
        String(stage.machine_code || "").trim() ===
          String(row.machine_code || "").trim()
    );

    return {
      ...row,
      source_table: "ict_results",
      machine_type:
        configuredStage?.external_machine_type || "UNKNOWN",
      attempted_at: row.imported_at,
    };
  });

  const allAttempts = sortChronologically(
    externalMachineAttempts
  );

  // ------------------------------------------------------------
  // 7. Build dynamic external machine summary
  // ------------------------------------------------------------

  const machineSummary = {};

  for (const row of allAttempts) {
    const machineCode = row.machine_code || "UNKNOWN";
    const machineName =
      row.machine_name || "Unknown machine";

    const key = `${machineCode}|${machineName}`;

    if (!machineSummary[key]) {
      machineSummary[key] = {
        machine_code: machineCode,
        machine_name: machineName,
        machine_type: row.machine_type || "UNKNOWN",
        attempts: 0,
        passes: 0,
        failures: 0,
      };
    }

    const summary = machineSummary[key];

    summary.attempts += 1;

    const result = String(row.result || "")
      .trim()
      .toUpperCase();

    if (result === "PASS") {
      summary.passes += 1;
    }

    if (result === "FAIL") {
      summary.failures += 1;
    }
  }

  const machineSummaryList = Object.values(machineSummary);

  const countFailures = (rows) =>
    rows.filter(
      (row) =>
        String(row.result || "").trim().toUpperCase() === "FAIL"
    ).length;

  const countPasses = (rows) =>
    rows.filter(
      (row) =>
        String(row.result || "").trim().toUpperCase() === "PASS"
    ).length;

  const totalFailures = countFailures(allAttempts);
  const totalPasses = countPasses(allAttempts);

  // ------------------------------------------------------------
  // 8. Fetch quality / rework / rejection history
  //    Scoped through the selected production_order_item_id
  // ------------------------------------------------------------

  const itemIds = [
    ...new Set(
      orderItems
        .map((row) => Number(row.production_order_item_id))
        .filter(
          (id) => Number.isInteger(id) && id > 0
        )
    ),
  ];

  let qualityHistory = [];

  if (itemIds.length) {
    const placeholders = itemIds.map(() => "?").join(",");

    const [historyRows] = await pool.query(
      `SELECT
         qh.id,
         qh.production_order_item_id,
         qh.action_type,
         qh.rework_station_id,
         rs.name AS rework_station_name,
         qh.stage_id,
         st.name AS stage_name,
         qh.reason,
         qh.performed_by,
         u.username AS performed_by_username,
         u.name AS performed_by_name,
         qh.created_at
       FROM production_item_quality_history qh
       LEFT JOIN rework_stations rs
         ON rs.id = qh.rework_station_id
       LEFT JOIN stages st
         ON st.id = qh.stage_id
       LEFT JOIN users u
         ON u.id = qh.performed_by
       WHERE qh.production_order_item_id IN (${placeholders})
       ORDER BY qh.created_at ASC, qh.id ASC`,
      itemIds
    );

    qualityHistory = historyRows;
  }

  // ------------------------------------------------------------
  // 9. Fetch legacy production records separately.
  //    These records are NOT guaranteed to belong to selected PO.
  // ------------------------------------------------------------

  const [serialLevelProductions] = await pool.query(
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

  // ------------------------------------------------------------
  // 10. Fetch box records separately.
  //     These records are also serial-level, not PO-verified.
  // ------------------------------------------------------------

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
     INNER JOIN boxes b
       ON b.id = bi.box_id
     WHERE bi.serial_no = ?
     ORDER BY b.id DESC`,
    [serial]
  );

  // ------------------------------------------------------------
  // 11. Return selected PO history and separate serial-level data
  // ------------------------------------------------------------

  return {
    serial_no: serial,
    searched_value: serialInput,
    customer_qr: customerQr,

    // Selected PO information only.
    production_order: selectedOrder,
    production_orders: orderItems,

    // PO-specific traceability.
    scan_history: scans,

    failure_summary: {
      configured_stage_flow: configuredStageFlow,

      configured_external_machine_codes:
        configuredMachineCodes,

      quality_history: qualityHistory,

      quality_summary: {
        total_rework_cycles: qualityHistory.filter(
          (event) => event.action_type === "REWORK_STARTED"
        ).length,

        total_rework_submissions: qualityHistory.filter(
          (event) => event.action_type === "REWORK_SUBMITTED"
        ).length,

        total_qa_approvals: qualityHistory.filter(
          (event) => event.action_type === "QA_APPROVED"
        ).length,

        total_qa_send_backs: qualityHistory.filter(
          (event) => event.action_type === "QA_SENT_BACK"
        ).length,

        total_rejections: qualityHistory.filter(
          (event) => event.action_type === "REJECTED"
        ).length,
      },

      total_recorded_machine_failures: totalFailures,
      total_attempts: allAttempts.length,
      total_passes: totalPasses,

      note: "To verify the source of these results, navigate to Product Configuration → Stage Flow and check the stages marked as External Machine Dependency along with their configured Machine Codes. These codes determine which external machine records are fetched and displayed for the selected product.",
    },

    // External machine results for configured machine codes only.
    machine_tests: {
      attempts: allAttempts,
      by_machine: machineSummaryList,
    },

    // These records are not guaranteed to belong to the selected PO.
    serial_level_records: {
      productions: serialLevelProductions,
      boxes: boxRows,

      note:
        "These records are retrieved by serial number only. Their relationship to the selected production order is not verified.",
    },
  };
}


export const searchSerialHistory = async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const serial = String(req.query.serial || "").trim();

      const hasProductionOrderId =
        req.query.productionOrderId !== undefined;

      const productionOrderId = hasProductionOrderId
        ? Number(req.query.productionOrderId)
        : null;

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

    // First request: return matching PO choices only.
    if (!hasProductionOrderId) {
      const data = await getSerialOrderOptions(serial);

      if (!data.production_orders.length) {
        return res.status(404).json({
          success: false,
          message: "No production orders found for this serial.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Production orders retrieved. Select one to view history.",
        data,
      });
    }

    if (
      !Number.isInteger(productionOrderId) ||
      productionOrderId <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid productionOrderId.",
      });
    }

    // Second request: load the selected PO's history.
    const data = await getSerialHistory(serial, productionOrderId);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "This serial does not belong to the selected production order.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Selected production order history retrieved.",
      data,
    });
  } catch (error) {
    console.error("Serial history search failed:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve traceability.",
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
        getSerialHistory(serialInput, productionOrderId)
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
