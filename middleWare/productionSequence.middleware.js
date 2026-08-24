import { pool } from "../DB/config/mysql.config.js";

/**
 * Validate barcode against the active Production Order
 * and the current Stage sequence.
 *
 * Expected request body:
 * {
 *   productionOrderId,
 *   stageId,
 *   serialNo
 * }
 */
export const validateProductionSequence = async (req, res, next) => {
  try {
    const {
      productionOrderId,
      stageId,
      serialNo,
    } = req.body;

    if (!productionOrderId) {
      return res.status(400).json({
        success: false,
        code: "PRODUCTION_ORDER_REQUIRED",
        message: "Production order is required",
      });
    }

    if (!stageId) {
      return res.status(400).json({
        success: false,
        code: "STAGE_REQUIRED",
        message: "Stage is required",
      });
    }

    if (!serialNo?.trim()) {
      return res.status(400).json({
        success: false,
        code: "SERIAL_NO_REQUIRED",
        message: "Serial number is required",
      });
    }

    // ============================================================
    // Get Production Order
    // ============================================================

    const [orderRows] = await pool.query(
      `
      SELECT
        id,
        product_id,
        line_id,
        serial_start,
        serial_end,
        sequence_mode,
        status
      FROM production_orders
      WHERE id = ?
      `,
      [productionOrderId]
    );

    if (orderRows.length === 0) {
      return res.status(404).json({
        success: false,
        code: "PRODUCTION_ORDER_NOT_FOUND",
        message: "Production order not found",
      });
    }

    const order = orderRows[0];

    // ============================================================
    // Production Order must be RUNNING
    // ============================================================

    if (order.status !== "RUNNING") {
      return res.status(400).json({
        success: false,
        code: "PRODUCTION_ORDER_NOT_RUNNING",
        message:
          `Production order is ${order.status.toLowerCase()}`,
      });
    }

    // ============================================================
    // Find Serial in Production Order
    // ============================================================

    const [itemRows] = await pool.query(
      `
      SELECT
        id,
        serial_no,
        sequence_no,
        status
      FROM production_order_items
      WHERE production_order_id = ?
        AND serial_no = ?
      `,
      [
        productionOrderId,
        serialNo.trim(),
      ]
    );

    if (itemRows.length === 0) {
      return res.status(400).json({
        success: false,
        code: "SERIAL_NOT_IN_PRODUCTION_ORDER",
        message:
          "This serial number does not belong to the production order",
      });
    }

    const item = itemRows[0];

    // ============================================================
    // Globally rejected serial
    // ============================================================

    if (item.status === "REJECTED") {
      return res.status(409).json({
        success: false,
        code: "SERIAL_REJECTED",
        message:
          "This product has been rejected and cannot continue production",
        serialNo: item.serial_no,
      });
    }

    // ============================================================
    // Get Stage State
    // ============================================================

    const [stageRows] = await pool.query(
      `
      SELECT
        pos.id,
        pos.stage_id,
        pos.sequence_order,
        pos.next_expected_sequence,
        pos.status
      FROM production_order_stages pos
      WHERE pos.production_order_id = ?
        AND pos.stage_id = ?
      `,
      [
        productionOrderId,
        stageId,
      ]
    );

    if (stageRows.length === 0) {
      return res.status(400).json({
        success: false,
        code: "STAGE_NOT_IN_PRODUCTION_ORDER",
        message:
          "This stage is not part of the production order",
      });
    }

    const stage = stageRows[0];

    // ============================================================
    // Stage must be RUNNING
    // ============================================================

    if (stage.status !== "RUNNING") {
      return res.status(400).json({
        success: false,
        code: "STAGE_NOT_RUNNING",
        message: "This production stage is not running",
      });
    }

    // ============================================================
    // NON-SEQUENTIAL
    // ============================================================

    if (order.sequence_mode === "NON_SEQUENTIAL") {
      req.productionOrder = order;
      req.productionOrderItem = item;
      req.productionOrderStage = stage;

      return next();
    }

    // ============================================================
    // SEQUENTIAL
    // ============================================================

    const expectedSequence = Number(
      stage.next_expected_sequence
    );

    const scannedSequence = Number(
      item.sequence_no
    );

    // ------------------------------------------------------------
    // Correct sequence
    // ------------------------------------------------------------

    if (scannedSequence === expectedSequence) {
      req.productionOrder = order;
      req.productionOrderItem = item;
      req.productionOrderStage = stage;

      return next();
    }

    // ------------------------------------------------------------
    // Exactly one ahead
    //
    // Example:
    // expected = 04
    // scanned  = 05
    // ------------------------------------------------------------

    if (scannedSequence === expectedSequence + 1) {
      return res.status(409).json({
        success: false,
        code: "SEQUENCE_SKIP_CONFIRMATION_REQUIRED",

        message:
          `Wrong sequence. Expected ${expectedSequence} but scanned ${scannedSequence}.`,

        expectedSequence,
        scannedSequence,

        expectedSerial: await getExpectedSerial(
          productionOrderId,
          expectedSequence
        ),

        scannedSerial: item.serial_no,

        question:
          `Was serial ${await getExpectedSerial(
            productionOrderId,
            expectedSequence
          )} rejected?`,
      });
    }

    // ------------------------------------------------------------
    // More than one ahead
    //
    // Example:
    // expected = 04
    // scanned  = 06
    // ------------------------------------------------------------

    if (scannedSequence > expectedSequence + 1) {
      return res.status(409).json({
        success: false,
        code: "SEQUENCE_FALLBACK",

        message:
          `Sequence fallback. Expected ${expectedSequence} but scanned ${scannedSequence}.`,

        expectedSequence,
        scannedSequence,

        expectedSerial: await getExpectedSerial(
          productionOrderId,
          expectedSequence
        ),

        scannedSerial: item.serial_no,
      });
    }

    // ------------------------------------------------------------
    // Older sequence
    //
    // Example:
    // expected = 06
    // scanned  = 04
    // ------------------------------------------------------------

    return res.status(409).json({
      success: false,
      code: "SEQUENCE_FALLBACK",

      message:
        `Sequence fallback. Expected ${expectedSequence} but scanned ${scannedSequence}.`,

      expectedSequence,
      scannedSequence,

      expectedSerial: await getExpectedSerial(
        productionOrderId,
        expectedSequence
      ),

      scannedSerial: item.serial_no,
    });

  } catch (error) {
    console.error(
      "ERR IN PRODUCTION SEQUENCE MIDDLEWARE:",
      error
    );

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};


// ============================================================
// Get expected serial from sequence
// ============================================================

const getExpectedSerial = async (productionOrderId, sequence) => {
  const [rows] = await pool.query(
    `
    SELECT serial_no
    FROM production_order_items
    WHERE production_order_id = ?
      AND sequence_no = ?
    LIMIT 1
    `,
    [
      productionOrderId,
      sequence,
    ]
  );

  return rows.length > 0
    ? rows[0].serial_no
    : null;
};