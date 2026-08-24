export const validateProductionOrderSequence = async (conn,{
    factoryId,
    productId,
    lineId,
    stageId,
    scannedValue,
  }
) => {
  
  const normalizedScannedValue = scannedValue?.trim();

  if (!normalizedScannedValue) {
    return {
      ok: false,
      errorType: "INVALID_SERIAL",
      message: "Scanned serial number is required.",
    };
  }

  // ============================================================
  // 1. Validate physical station
  // User -> Factory -> Line -> Stage
  // ============================================================

  const [stationRows] = await conn.query(
    `
    SELECT s.id, s.name
    FROM stages s
    WHERE s.id = ?
      AND s.line_id = ?
      AND s.factory_id = ?
      AND s.is_active = 1
    LIMIT 1
    `,
    [stageId, lineId, factoryId]
  );

  if (!stationRows.length) {
    return {
      ok: false,
      errorType: "INVALID_STATION",
      message: "This stage is not active or does not belong to the current production line.",
    };
  }

  // ============================================================
  // 2. Find Production Order Item from scanned serial
  // ============================================================

  const [itemRows] = await conn.query(
    `
    SELECT
      poi.id AS item_id,
      poi.production_order_id,
      poi.serial_no,
      poi.sequence_no,
      poi.status AS item_status,

      po.id AS production_order_id,
      po.order_no,
      po.factory_id,
      po.product_id,
      po.line_id,
      po.sequence_mode,
      po.status AS order_status,
      po.target_qty,
      po.serial_start,
      po.serial_end

    FROM production_order_items poi

    INNER JOIN production_orders po
      ON po.id = poi.production_order_id

    WHERE poi.serial_no = ?
      AND po.factory_id = ?
      AND po.product_id = ?
      AND po.line_id = ?

    ORDER BY
      CASE WHEN po.status = 'RUNNING' THEN 0 ELSE 1 END,
      po.id DESC

    LIMIT 1
    `,
    [
      normalizedScannedValue,
      factoryId,
      productId,
      lineId,
    ]
  );

 // ============================================================
  // 3. Serial does not belong to a Production Order
  // ============================================================

  if (!itemRows.length) {

    // ----------------------------------------------------------
    // Check latest production order for this production context
    // ----------------------------------------------------------

    const [latestOrderRows] = await conn.query(
      `
      SELECT
        id,
        order_no,
        status,
        target_qty,
        completed_at
      FROM production_orders
      WHERE factory_id = ?
        AND product_id = ?
        AND line_id = ?
      ORDER BY id DESC
      LIMIT 1
      `,
      [
        factoryId,
        productId,
        lineId,
      ]
    );

    // ----------------------------------------------------------
    // Latest PO is already completed
    // ----------------------------------------------------------

    if (latestOrderRows.length && latestOrderRows[0].status === "COMPLETED") {
      const completedOrder = latestOrderRows[0];

      return {
        ok: false,
        errorType: "PRODUCTION_ORDER_COMPLETED",
        message: `Production order ${completedOrder.order_no} is already completed. ` +
          `Target quantity of ${completedOrder.target_qty} has been achieved. ` +
          `Please create or start a new production order to continue production.`,

        productionOrderId: completedOrder.id,
        productionOrderNo: completedOrder.order_no,
        targetQty: Number(completedOrder.target_qty),
        scannedSerial: normalizedScannedValue,
      };
    }

    // ----------------------------------------------------------
    // No completed/current PO explanation applies
    // ----------------------------------------------------------

    return {
      ok: false,
      errorType: "SERIAL_NOT_IN_PRODUCTION_ORDER",
      message:"This serial number does not belong to a production order for this factory, product, and production line.",
      scannedSerial: normalizedScannedValue,
    };

  }

  const item = itemRows[0];

  // ============================================================
  // 4. Production Order must be RUNNING
  // ============================================================

  if (item.order_status !== "RUNNING") {
    return {
      ok: false,
      errorType: "PRODUCTION_ORDER_NOT_RUNNING",
      message:
        `This serial belongs to production order ${item.order_no}, ` +
        `which is currently ${item.order_status}.`,
      productionOrderId: item.production_order_id,
      scannedSerial: item.serial_no,
    };
  }

  // ============================================================
  // 5. Rejected PCB
  // ============================================================

  if (item.item_status === "REJECTED") {
    return {
      ok: false,
      errorType: "SERIAL_REJECTED",
      message: "This product has been rejected and cannot continue production.",
      productionOrderId: item.production_order_id,
      serialNo: item.serial_no,
    };
  }

  // ============================================================
  // 6. Validate current Product Stage Flow
  // ============================================================

  const [flowRows] = await conn.query(
    `
    SELECT
      id,
      sequence_no,
      scan_mode
    FROM product_stage_flow
    WHERE product_id = ?
      AND stage_id = ?
    LIMIT 1
    `,
    [item.product_id, stageId]
  );

  if (!flowRows.length) {
    return {
      ok: false,
      errorType: "STAGE_NOT_IN_PRODUCT_FLOW",
      message: "This stage is not configured in the product's stage flow.",
      productionOrderId: item.production_order_id,
    };
  }

  const productStage = flowRows[0];
  const currentSequence = Number(productStage.sequence_no);

  // ============================================================
  // 7. First Stage
  // No previous stage validation required
  // ============================================================

  if (currentSequence === 1) {
    return {
      ok: true,

      productionOrder: {
        id: item.production_order_id,
        order_no: item.order_no,
        factory_id: item.factory_id,
        product_id: item.product_id,
        line_id: item.line_id,
        target_qty: item.target_qty,
        sequence_mode: item.sequence_mode,
        status: item.order_status,
        serial_start: item.serial_start,
        serial_end: item.serial_end,
      },

      productionOrderItem: {
        id: item.item_id,
        production_order_id: item.production_order_id,
        serial_no: item.serial_no,
        sequence_no: item.sequence_no,
        status: item.item_status,
      },

      productionOrderStage: null,
      productStageFlow: productStage,
    };
  }

  // ============================================================
  // 8. NON-SEQUENTIAL Production Order
  // ============================================================

  if (item.sequence_mode === "NON_SEQUENTIAL") {
    return {
      ok: true,

      productionOrder: {
        id: item.production_order_id,
        order_no: item.order_no,
        factory_id: item.factory_id,
        product_id: item.product_id,
        line_id: item.line_id,
        target_qty: item.target_qty,
        sequence_mode: item.sequence_mode,
        status: item.order_status,
        serial_start: item.serial_start,
        serial_end: item.serial_end,
      },

      productionOrderItem: {
        id: item.item_id,
        production_order_id: item.production_order_id,
        serial_no: item.serial_no,
        sequence_no: item.sequence_no,
        status: item.item_status,
      },

      productionOrderStage: null,
      productStageFlow: productStage,
    };
  }

  // ============================================================
  // 9. Find Previous Stage
  // Current sequence 2 -> previous sequence 1
  // Current sequence 3 -> previous sequence 2
  // ============================================================

  const previousSequence = currentSequence - 1;

  const [previousStageRows] = await conn.query(
    `
    SELECT
      id,
      stage_id,
      sequence_no,
      scan_mode
    FROM product_stage_flow
    WHERE product_id = ?
      AND sequence_no = ?
    LIMIT 1
    `,
    [
      item.product_id,
      previousSequence,
    ]
  );

  if (!previousStageRows.length) {
    return {
      ok: false,
      errorType: "PREVIOUS_STAGE_NOT_FOUND",
      message:
        `Previous stage with sequence ${previousSequence} ` +
        `is not configured for this product.`,
      productionOrderId: item.production_order_id,
      expectedSequence: previousSequence,
      scannedSerial: item.serial_no,
    };
  }

  const previousStage = previousStageRows[0];

  // ============================================================
  // 10. Check Previous Stage Success
  //
  // Same:
  // Production Order
  // Serial
  // Previous Stage
  // SUCCESS
  // ============================================================

  const [previousScanRows] = await conn.query(
    `
    SELECT
      id,
      scanned_value,
      stage_id,
      sequence_no,
      status
    FROM scan_history
    WHERE production_order_id = ?
      AND scanned_value = ?
      AND stage_id = ?
      AND status = 'SUCCESS'
    ORDER BY id DESC
    LIMIT 1
    `,
    [
      item.production_order_id,
      item.serial_no,
      previousStage.stage_id,
    ]
  );

  if (!previousScanRows.length) {
    return {
      ok: false,
      errorType: "PREVIOUS_STAGE_NOT_COMPLETED",
      message:
        `This serial has not successfully completed the previous stage ` +
        `(sequence ${previousSequence}).`,
      productionOrderId: item.production_order_id,
      expectedSequence: previousSequence,
      expectedSerial: item.serial_no,
      scannedSequence: item.sequence_no,
      scannedSerial: item.serial_no,
      previousStageId: previousStage.stage_id,
      previousStageSequence: previousStage.sequence_no,
    };
  }

  // ============================================================
  // 11. Current Stage Validation Successful
  // ============================================================

  return {
    ok: true,

    productionOrder: {
      id: item.production_order_id,
      order_no: item.order_no,
      factory_id: item.factory_id,
      product_id: item.product_id,
      line_id: item.line_id,
      target_qty: item.target_qty,
      sequence_mode: item.sequence_mode,
      status: item.order_status,
      serial_start: item.serial_start,
      serial_end: item.serial_end,
    },

    productionOrderItem: {
      id: item.item_id,
      production_order_id: item.production_order_id,
      serial_no: item.serial_no,
      sequence_no: item.sequence_no,
      status: item.item_status,
    },

    productionOrderStage: null,
    productStageFlow: productStage,

    previousStage: {
      id: previousStage.id,
      stage_id: previousStage.stage_id,
      sequence_no: previousStage.sequence_no,
      scan_mode: previousStage.scan_mode,
    },

    previousScan: previousScanRows[0],
  };
};