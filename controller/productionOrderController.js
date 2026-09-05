import { pool } from "../DB/config/mysql.config.js";

// ============================================================
// PRODUCTION SERIAL RULE HELPERS
// ============================================================


export const createProductionOrder = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const {
      productId,
      lineId,
      targetQty,
      sequenceMode = "NON_SEQUENTIAL",
      plannedDate,
    } = req.body;

    // ============================================================
    // GET USER'S FACTORY
    // ============================================================

    const [userRows] = await connection.query(
      `
      SELECT factory_id
      FROM users
      WHERE id = ?
      `,
      [req.user?.id || null]
    );

    if (!userRows.length || !userRows[0].factory_id) {
      return res.status(400).json({
        message: "User is not assigned to a factory",
      });
    }

    const factoryId = userRows[0].factory_id;

    // ============================================================
    // BASIC VALIDATION
    // ============================================================

    if (!productId) {
      return res.status(400).json({
        message: "Product is required",
      });
    }

    if (!lineId) {
      return res.status(400).json({
        message: "Production line is required",
      });
    }

    if (!targetQty || Number(targetQty) <= 0) {
      return res.status(400).json({
        message: "Valid target quantity is required",
      });
    }

    if (!Number.isInteger(Number(targetQty))) {
      return res.status(400).json({
        message: "Target quantity must be a whole number",
      });
    }

    if (!["SEQUENTIAL", "NON_SEQUENTIAL"].includes(sequenceMode)) {
      return res.status(400).json({
        message: "sequenceMode must be SEQUENTIAL or NON_SEQUENTIAL",
      });
    }

    const quantity = Number(targetQty);

    // ============================================================
    // START TRANSACTION
    // ============================================================

    await connection.beginTransaction();

    // ============================================================
    // VALIDATE FACTORY
    // ============================================================

    const [factoryRows] = await connection.query(
      `
      SELECT id, name
      FROM factories
      WHERE id = ?
      `,
      [factoryId]
    );

    if (!factoryRows.length) {
      throw new Error("Factory not found");
    }

    // ============================================================
    // VALIDATE PRODUCT
    // ============================================================

    const [productRows] = await connection.query(
      `
      SELECT
        id,
        name,
        part_code,
        erp_no
      FROM products
      WHERE id = ?
        AND is_active = 1
      LIMIT 1
      `,
      [productId]
    );

    if (!productRows.length) {
      throw new Error("Product not found");
    }

    const product = productRows[0];

    // ============================================================
    // VALIDATE PRODUCTION LINE
    // ============================================================

    const [lineRows] = await connection.query(
      `
      SELECT
        id,
        name,
        factory_id
      FROM production_lines
      WHERE id = ?
        AND factory_id = ?
        AND is_active = 1
      LIMIT 1
      `,
      [lineId, factoryId]
    );

    if (!lineRows.length) {
      throw new Error("Production line not found in user's factory");
    }

    // ============================================================
    // GET PRODUCT STAGE FLOW
    // ============================================================

    const [stageFlowRows] = await connection.query(
      `
      SELECT
        psf.stage_id,
        psf.sequence_no
      FROM product_stage_flow psf

      INNER JOIN stages s
        ON s.id = psf.stage_id

      WHERE psf.product_id = ?
        AND s.factory_id = ?
        AND s.is_active = 1

      ORDER BY psf.sequence_no ASC
      `,
      [productId, factoryId]
    );

    if (!stageFlowRows.length) {
      throw new Error(
        "No stage flow configured for this product in this factory"
      );
    }

    // ============================================================
    // GET PRODUCT SERIAL RULE
    //
    // IMPORTANT:
    // Product-level only.
    // Production Order does NOT generate serials.
    // ============================================================

    const [serialRuleRows] = await connection.query(
      `
      SELECT
        id,
        product_id,
        rule,
        current_year,
        current_week,
        next_serial,
        is_active
      FROM production_serial_rules
      WHERE product_id = ?
        AND is_active = 1
      LIMIT 1
      `,
      [productId]
    );

    if (!serialRuleRows.length) {
      throw new Error(
        "No active production serial rule configured for this product"
      );
    }

    const serialRule = serialRuleRows[0];

    // ============================================================
    // PARSE RULE
    // ============================================================

    let rule;

    try {
      rule =
        typeof serialRule.rule === "string"
          ? JSON.parse(serialRule.rule)
          : serialRule.rule;
    } catch {
      throw new Error(
        "Production serial rule contains invalid JSON"
      );
    }

    if (!Array.isArray(rule) || !rule.length) {
      throw new Error("Production serial rule is invalid");
    }

    // ============================================================
    // FIND SERIAL SEGMENT
    // ============================================================

    const serialSegments = rule.filter(
      (segment) => segment?.type === "SERIAL"
    );

    if (serialSegments.length !== 1) {
      throw new Error(
        "Production serial rule must contain exactly one SERIAL segment"
      );
    }

    const serialWidth = Number(serialSegments[0].width);

    if (
      !Number.isInteger(serialWidth) ||
      serialWidth < 1 ||
      serialWidth > 5
    ) {
      throw new Error(
        "Production serial rule has an invalid SERIAL width"
      );
    }

    // ============================================================
    // FIND AVAILABLE QR IDENTITIES
    //
    // IMPORTANT:
    // QR pool is PRODUCT-level.
    //
    // Production orders DO NOT consume the QR pool.
    //
    // The same QR identity may be assigned to different
    // production lines.
    // ============================================================

    const [qrRows] = await connection.query(
      `
      SELECT
        id,
        bucket_id,
        product_id,
        serial_no,
        qr_data,
        status
      FROM production_qr_codes
      WHERE product_id = ?
        AND status IN ('GENERATED', 'PRINTED')
      ORDER BY id ASC
      `,
      [productId]
    );

    if (qrRows.length < quantity) {
      throw new Error(
        `Insufficient generated Product QR codes. Required: ${quantity}, available: ${qrRows.length}`
      );
    }

    // ============================================================
    // SELECT QR IDENTITIES NOT ALREADY ASSIGNED TO THIS LINE
    //
    // IMPORTANT:
    //
    // Same QR on different lines = ALLOWED
    // Same QR on same line = NOT ALLOWED
    // ============================================================

    const candidateQrRows = [];

    for (const qr of qrRows) {
      const [existingRows] = await connection.query(
        `
        SELECT poi.id
        FROM production_order_items poi

        INNER JOIN production_orders po
          ON po.id = poi.production_order_id

        WHERE po.line_id = ?
          AND po.product_id = ?
          AND poi.serial_no = ?

        LIMIT 1
        `,
        [lineId, productId, qr.qr_data]
      );

      if (!existingRows.length) {
        candidateQrRows.push(qr);
      }

      if (candidateQrRows.length >= quantity) {
        break;
      }
    }

    if (candidateQrRows.length < quantity) {
      throw new Error(
        `Insufficient unassigned Product QR identities for this production line. Required: ${quantity}, available: ${candidateQrRows.length}`
      );
    }

    // ============================================================
    // LOCK SELECTED QR IDENTITIES
    //
    // Re-check after locking to prevent concurrent assignment.
    // ============================================================

    const qrIds = candidateQrRows.map((row) => row.id);
    const placeholders = qrIds.map(() => "?").join(",");

    const [lockedQrRows] = await connection.query(
      `
      SELECT
        id,
        bucket_id,
        product_id,
        serial_no,
        qr_data,
        status
      FROM production_qr_codes
      WHERE id IN (${placeholders})
        AND product_id = ?
        AND status IN ('GENERATED', 'PRINTED')
      ORDER BY id ASC
      FOR UPDATE
      `,
      [...qrIds, productId]
    );

    if (lockedQrRows.length < quantity) {
      throw new Error(
        "Some selected Product QR codes are no longer available"
      );
    }

    // ============================================================
    // GENERATE PRODUCTION ORDER NUMBER
    // ============================================================

    const today = new Date();

    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");

    const datePrefix = `PO${year}${month}${day}`;

    const [orderRows] = await connection.query(
      `
      SELECT order_no
      FROM production_orders
      WHERE order_no LIKE ?
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [`${datePrefix}%`]
    );

    let orderNumber = 1;

    if (orderRows.length) {
      const lastOrderNo = String(orderRows[0].order_no || "");

      const suffix = lastOrderNo.slice(datePrefix.length);
      const lastNumber = parseInt(suffix, 10);

      if (Number.isInteger(lastNumber)) {
        orderNumber = lastNumber + 1;
      }
    }

    const orderNo = `${datePrefix}${String(orderNumber).padStart(3, "0")}`;
    
    // ============================================================
    // LEGACY SERIAL SNAPSHOT
    //
    // Keep these fields because the current production_orders
    // schema still contains them.
    //
    // IMPORTANT:
    // They are NOT used to generate or control QR identities.
    // ============================================================

    const firstQr = lockedQrRows[0];

    const serialStart = 1;
    const serialEnd = quantity;

    const serialPrefix = firstQr.qr_data?.slice(0, Math.max(0, firstQr.qr_data.length - serialWidth)) || "";

    // ============================================================
    // CREATE PRODUCTION ORDER
    // ============================================================

    const [orderResult] = await connection.query(
      `
      INSERT INTO production_orders (
        order_no,
        factory_id,
        product_id,
        line_id,
        target_qty,
        serial_prefix,
        serial_start,
        serial_end,
        serial_width,
        sequence_mode,
        status,
        planned_date,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANNED', ?, ?)
      `,
      [
        orderNo,
        factoryId,
        productId,
        lineId,
        quantity,
        serialPrefix,
        serialStart,
        serialEnd,
        serialWidth,
        sequenceMode,
        plannedDate || today,
        req.user?.id || null,
      ]
    );

    const productionOrderId = orderResult.insertId;

    // ============================================================
    // CREATE PRODUCTION ORDER ITEMS
    //
    // Complete physical QR identity is stored.
    //
    // sequence_no is LOCAL to this production order.
    // ============================================================

    const itemValues = lockedQrRows
      .slice(0, quantity)
      .map((qr, index) => [
        productionOrderId,
        qr.qr_data,
        index + 1,
        "ACTIVE",
      ]);

    if (itemValues.length) {
      await connection.query(
        `
        INSERT INTO production_order_items (
          production_order_id,
          serial_no,
          sequence_no,
          status
        )
        VALUES ?
        `,
        [itemValues]
      );
    }

    // ============================================================
    // CREATE PRODUCTION ORDER STAGES
    // ============================================================

    const stageValues = stageFlowRows.map((stage) => [
      productionOrderId,
      stage.stage_id,
      stage.sequence_no,
      1,
      "PENDING",
    ]);

    await connection.query(
      `
      INSERT INTO production_order_stages (
        production_order_id,
        stage_id,
        sequence_order,
        next_expected_sequence,
        status
      )
      VALUES ?
      `,
      [stageValues]
    );

    // ============================================================
    // COMMIT
    // ============================================================

    await connection.commit();

    // ============================================================
    // RESPONSE
    // ============================================================

    return res.status(201).json({
      message: "Production order created successfully",

      data: {
        id: productionOrderId,
        orderNo,

        factoryId,
        factoryName: factoryRows[0].name,

        productId,
        productName: product.name,

        lineId,
        lineName: lineRows[0].name,

        targetQty: quantity,

        // Legacy snapshot fields
        serialPrefix,
        serialStart,
        serialEnd,
        serialWidth,

        serialRuleId: serialRule.id,

        qrRange: {
          from: lockedQrRows[0].qr_data,
          to: lockedQrRows[quantity - 1].qr_data,
        },

        sequenceMode,

        status: "PLANNED",

        stageCount: stageFlowRows.length,
      },
    });
  } catch (error) {
    await connection.rollback();

    console.error(
      "ERR IN CREATE PRODUCTION ORDER:",
      error
    );

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message:
          "Production order or serial number already exists",
      });
    }

    return res.status(500).json({
      message: error.message,
    });
  } finally {
    connection.release();
  }
};

export const updateProductionOrder = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id } = req.params;

    const {
      productId,
      lineId,
      targetQty,
      sequenceMode = "NON_SEQUENTIAL",
      plannedDate,
    } = req.body;

    // ============================================================
    // BASIC VALIDATION
    // ============================================================

    if (!productId) {
      return res.status(400).json({ message: "Product is required" });
    }

    if (!lineId) {
      return res.status(400).json({ message: "Production line is required" });
    }

    if (!targetQty || Number(targetQty) <= 0) {
      return res.status(400).json({ message: "Valid target quantity is required" });
    }

    if (!Number.isInteger(Number(targetQty))) {
      return res.status(400).json({ message: "Target quantity must be a whole number" });
    }

    if (!["SEQUENTIAL", "NON_SEQUENTIAL"].includes(sequenceMode)) {
      return res.status(400).json({
        message: "sequenceMode must be SEQUENTIAL or NON_SEQUENTIAL",
      });
    }

    const quantity = Number(targetQty);

    // ============================================================
    // GET USER FACTORY
    // ============================================================

    const [userRows] = await connection.query(
      `
      SELECT factory_id
      FROM users
      WHERE id = ?
      `,
      [req.user?.id || null]
    );

    if (!userRows.length || !userRows[0].factory_id) {
      return res.status(400).json({
        message: "User is not assigned to a factory",
      });
    }

    const factoryId = userRows[0].factory_id;

    // ============================================================
    // START TRANSACTION
    // ============================================================

    await connection.beginTransaction();

    // ============================================================
    // LOCK EXISTING ORDER
    // ============================================================

    const [existingRows] = await connection.query(
      `
      SELECT
        id,
        status,
        product_id AS old_product_id,
        line_id AS old_line_id
      FROM production_orders
      WHERE id = ?
      FOR UPDATE
      `,
      [id]
    );

    if (!existingRows.length) {
      throw new Error("Production order not found");
    }

    const existingOrder = existingRows[0];

    if (existingOrder.status !== "PLANNED") {
      throw new Error(
        `Order cannot be edited because it is already ${existingOrder.status.toLowerCase()}`
      );
    }

    // ============================================================
    // VALIDATE PRODUCT
    // ============================================================

    const [productRows] = await connection.query(
      `
      SELECT
        id,
        name,
        part_code,
        erp_no
      FROM products
      WHERE id = ?
        AND is_active = 1
      LIMIT 1
      `,
      [productId]
    );

    if (!productRows.length) {
      throw new Error("Product not found");
    }

    const product = productRows[0];

    // ============================================================
    // VALIDATE PRODUCTION LINE
    // ============================================================

    const [lineRows] = await connection.query(
      `
      SELECT
        id,
        name,
        factory_id
      FROM production_lines
      WHERE id = ?
        AND factory_id = ?
        AND is_active = 1
      LIMIT 1
      `,
      [lineId, factoryId]
    );

    if (!lineRows.length) {
      throw new Error("Production line not found in user's factory");
    }

    // ============================================================
    // GET PRODUCT STAGE FLOW
    // ============================================================

    const [stageFlowRows] = await connection.query(
      `
      SELECT
        psf.stage_id,
        psf.sequence_no
      FROM product_stage_flow psf

      INNER JOIN stages s
        ON s.id = psf.stage_id

      WHERE psf.product_id = ?
        AND s.factory_id = ?
        AND s.is_active = 1

      ORDER BY psf.sequence_no ASC
      `,
      [productId, factoryId]
    );

    if (!stageFlowRows.length) {
      throw new Error(
        "No stage flow configured for this product in this factory"
      );
    }

    // ============================================================
    // GET PRODUCT SERIAL RULE
    //
    // Product-level rule only.
    // Update does NOT modify the rule/counter.
    // ============================================================

    const [serialRuleRows] = await connection.query(
      `
      SELECT
        id,
        product_id,
        rule,
        current_year,
        current_week,
        next_serial,
        is_active
      FROM production_serial_rules
      WHERE product_id = ?
        AND is_active = 1
      LIMIT 1
      `,
      [productId]
    );

    if (!serialRuleRows.length) {
      throw new Error(
        "No active production serial rule configured for this product"
      );
    }

    const serialRule = serialRuleRows[0];

    // ============================================================
    // PARSE SERIAL RULE
    // ============================================================

    let rule;

    try {
      rule =
        typeof serialRule.rule === "string"
          ? JSON.parse(serialRule.rule)
          : serialRule.rule;
    } catch {
      throw new Error("Production serial rule contains invalid JSON");
    }

    if (!Array.isArray(rule) || !rule.length) {
      throw new Error("Production serial rule is invalid");
    }

    // ============================================================
    // GET SERIAL WIDTH
    // ============================================================

    const serialSegments = rule.filter(
      (segment) => segment?.type === "SERIAL"
    );

    if (serialSegments.length !== 1) {
      throw new Error(
        "Production serial rule must contain exactly one SERIAL segment"
      );
    }

    const serialWidth = Number(serialSegments[0].width);

    if (
      !Number.isInteger(serialWidth) ||
      serialWidth < 1 ||
      serialWidth > 5
    ) {
      throw new Error(
        "Production serial rule has an invalid SERIAL width"
      );
    }

    // ============================================================
    // GET AVAILABLE PRODUCT QR IDENTITIES
    // ============================================================

    const [qrRows] = await connection.query(
      `
      SELECT
        id,
        bucket_id,
        product_id,
        serial_no,
        qr_data,
        status
      FROM production_qr_codes
      WHERE product_id = ?
        AND status IN ('GENERATED', 'PRINTED')
      ORDER BY id ASC
      `,
      [productId]
    );

    if (qrRows.length < quantity) {
      throw new Error(
        `Insufficient generated Product QR codes. Required: ${quantity}, available: ${qrRows.length}`
      );
    }

    // ============================================================
    // SELECT QR IDENTITIES NOT ALREADY ASSIGNED TO THIS LINE
    //
    // IMPORTANT:
    // Same QR on another line = ALLOWED.
    // Same QR on this line = NOT ALLOWED.
    //
    // Exclude the CURRENT order because its items will be replaced.
    // ============================================================

    const candidateQrRows = [];

    for (const qr of qrRows) {
      const [existingItemRows] = await connection.query(
        `
        SELECT poi.id
        FROM production_order_items poi

        INNER JOIN production_orders po
          ON po.id = poi.production_order_id

        WHERE po.line_id = ?
          AND po.product_id = ?
          AND po.id <> ?
          AND poi.serial_no = ?

        LIMIT 1
        `,
        [lineId, productId, id, qr.qr_data]
      );

      if (!existingItemRows.length) {
        candidateQrRows.push(qr);
      }

      if (candidateQrRows.length >= quantity) {
        break;
      }
    }

    if (candidateQrRows.length < quantity) {
      throw new Error(
        `Insufficient unassigned Product QR identities for this production line. Required: ${quantity}, available: ${candidateQrRows.length}`
      );
    }

    // ============================================================
    // LOCK SELECTED QR IDENTITIES
    // ============================================================

    const qrIds = candidateQrRows.map((row) => row.id);
    const placeholders = qrIds.map(() => "?").join(",");

    const [lockedQrRows] = await connection.query(
      `
      SELECT
        id,
        bucket_id,
        product_id,
        serial_no,
        qr_data,
        status
      FROM production_qr_codes
      WHERE id IN (${placeholders})
        AND product_id = ?
        AND status IN ('GENERATED', 'PRINTED')
      ORDER BY id ASC
      FOR UPDATE
      `,
      [...qrIds, productId]
    );

    if (lockedQrRows.length < quantity) {
      throw new Error(
        "Some selected Product QR codes are no longer available"
      );
    }

    // ============================================================
    // LEGACY SERIAL SNAPSHOT
    //
    // These fields remain only because the existing
    // production_orders table still contains them.
    //
    // They are NOT used for QR generation.
    // ============================================================

    const firstQr = lockedQrRows[0];
    const lastQr = lockedQrRows[quantity - 1];

    const serialStart = firstQr.serial_no;
    const serialEnd = lastQr.serial_no;

    const serialPrefix =
      firstQr.qr_data?.slice(
        0,
        Math.max(0, firstQr.qr_data.length - serialWidth)
      ) || "";

    // ============================================================
    // UPDATE PRODUCTION ORDER
    // ============================================================

    await connection.query(
      `
      UPDATE production_orders
      SET
        product_id = ?,
        line_id = ?,
        target_qty = ?,
        serial_prefix = ?,
        serial_start = ?,
        serial_end = ?,
        serial_width = ?,
        sequence_mode = ?,
        planned_date = ?
      WHERE id = ?
      `,
      [
        productId,
        lineId,
        quantity,
        serialPrefix,
        serialStart,
        serialEnd,
        serialWidth,
        sequenceMode,
        plannedDate || new Date(),
        id,
      ]
    );

    // ============================================================
    // REMOVE OLD ITEMS + STAGES
    // ============================================================

    await connection.query(
      `
      DELETE FROM production_order_items
      WHERE production_order_id = ?
      `,
      [id]
    );

    await connection.query(
      `
      DELETE FROM production_order_stages
      WHERE production_order_id = ?
      `,
      [id]
    );

    // ============================================================
    // CREATE NEW ORDER ITEMS
    //
    // sequence_no is LOCAL to this production order.
    // ============================================================

    const itemValues = lockedQrRows
      .slice(0, quantity)
      .map((qr, index) => [
        id,
        qr.qr_data,
        index + 1,
        "ACTIVE",
      ]);

    if (itemValues.length) {
      await connection.query(
        `
        INSERT INTO production_order_items (
          production_order_id,
          serial_no,
          sequence_no,
          status
        )
        VALUES ?
        `,
        [itemValues]
      );
    }

    // ============================================================
    // CREATE NEW ORDER STAGES
    //
    // Always start from sequence 1 for a new PLANNED order.
    // ============================================================

    const stageValues = stageFlowRows.map((stage) => [
      id,
      stage.stage_id,
      stage.sequence_no,
      1,
      "PENDING",
    ]);

    await connection.query(
      `
      INSERT INTO production_order_stages (
        production_order_id,
        stage_id,
        sequence_order,
        next_expected_sequence,
        status
      )
      VALUES ?
      `,
      [stageValues]
    );

    // ============================================================
    // COMMIT
    // ============================================================

    await connection.commit();

    // ============================================================
    // RESPONSE
    // ============================================================

    return res.status(200).json({
      message: "Production order updated successfully",

      data: {
        id: Number(id),

        productId,
        productName: product.name,

        lineId,
        lineName: lineRows[0].name,

        targetQty: quantity,

        // Legacy snapshot fields
        serialPrefix,
        serialStart,
        serialEnd,
        serialWidth,

        serialRuleId: serialRule.id,

        qrRange: {
          from: firstQr.serial_no,
          to: lastQr.serial_no,
        },

        sequenceMode,

        status: "PLANNED",

        stageCount: stageFlowRows.length,
      },
    });
  } catch (error) {
    await connection.rollback();

    console.error("ERR IN UPDATE PRODUCTION ORDER:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Production order or serial number already exists",
      });
    }

    return res.status(500).json({
      message: error.message,
    });
  } finally {
    connection.release();
  }
};

export const deleteProductionOrder = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id } = req.params;

    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT id, status FROM production_orders WHERE id = ? FOR UPDATE`,
      [id]
    );

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Production order not found" });
    }

    const { status } = rows[0];

    if (status === "COMPLETED") {
      await connection.rollback();
      return res.status(400).json({
        message: "Completed orders are kept as production history and cannot be deleted",
      });
    }

    if (status === "RUNNING" || status === "PAUSED") {
      await connection.rollback();
      return res.status(400).json({
        message: `Order must be cancelled before it can be deleted (currently ${status.toLowerCase()})`,
      });
    }

    await connection.query(
      `DELETE FROM production_order_stages WHERE production_order_id = ?`,
      [id]
    );

    await connection.query(
      `DELETE FROM production_order_items WHERE production_order_id = ?`,
      [id]
    );

    await connection.query(`DELETE FROM production_orders WHERE id = ?`, [id]);

    await connection.commit();

    return res.status(200).json({ message: "Production order deleted successfully" });
  } catch (error) {
    await connection.rollback();

    console.error("ERR IN DELETE PRODUCTION ORDER:", error);

    return res.status(500).json({ message: error.message });
  } finally {
    connection.release();
  }
};

export const startProductionOrder = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id } = req.params;

    await connection.beginTransaction();

    // ============================================================
    // 1. Get Production Order
    // ============================================================

    const [orderRows] = await connection.query(
      `
      SELECT
        id,
        order_no,
        factory_id,
        product_id,
        line_id,
        status,
        target_qty,
        serial_start,
        serial_end
      FROM production_orders
      WHERE id = ?
      FOR UPDATE
      `,
      [id]
    );

    if (orderRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Production order not found",
      });
    }

    const order = orderRows[0];

    // ============================================================
    // 2. Validate Current Order Status
    // ============================================================

    if (order.status !== "PLANNED") {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        errorType: "INVALID_PRODUCTION_ORDER_STATUS",
        message:
          `Production order cannot be started because it is already ${order.status.toLowerCase()}.`,
      });
    }

    // ============================================================
    // 3. Prevent Multiple RUNNING Orders
    //    Same Factory + Same Product + Same Line
    //
    //    Same product CAN run simultaneously on different lines.
    // ============================================================

    const [runningOrderRows] = await connection.query(
      `
      SELECT
        id,
        order_no,
        target_qty,
        status
      FROM production_orders
      WHERE factory_id = ?
        AND product_id = ?
        AND line_id = ?
        AND status = 'RUNNING'
        AND id <> ?
      LIMIT 1
      FOR UPDATE
      `,
      [
        order.factory_id,
        order.product_id,
        order.line_id,
        order.id,
      ]
    );

    if (runningOrderRows.length > 0) {
      const runningOrder = runningOrderRows[0];

      await connection.rollback();

      return res.status(409).json({
        success: false,
        errorType: "PRODUCT_ALREADY_RUNNING_ON_LINE",
        message:
          `This product already has a running production order on this line ` +
          `(${runningOrder.order_no}). ` +
          `Please complete or cancel the existing production order before starting this one.`,
        runningProductionOrderId: runningOrder.id,
        runningProductionOrderNo: runningOrder.order_no,
        runningTargetQty: runningOrder.target_qty,
      });
    }

    // ============================================================
    // 4. Check Production Order Items
    // ============================================================

    const [itemRows] = await connection.query(
      `
      SELECT COUNT(*) AS count
      FROM production_order_items
      WHERE production_order_id = ?
      `,
      [id]
    );

    const itemCount = Number(itemRows[0].count);

    if (itemCount === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        errorType: "NO_PRODUCTION_ORDER_ITEMS",
        message: "Production order has no generated serial items.",
      });
    }

    // ============================================================
    // 5. Master Label Configuration
    //
    // Only calculate how many Master Labels this PO requires.
    //
    // No serial-capacity check.
    // No current_serial check.
    // No PRINTED check.
    // No QR-pool check.
    // ============================================================

    const [packagingRows] = await connection.query(
      `
      SELECT
        id,
        box_size,
        printer_id,
        barcode_format,
        label_template_id
      FROM packaging_config
      WHERE product_id = ?
        AND is_active = 1
      ORDER BY id DESC
      LIMIT 1
      `,
      [order.product_id]
    );

    if (!packagingRows.length) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        errorType: "MASTER_LABEL_CONFIG_REQUIRED",
        message:
          "Active Master Label packaging configuration is required for this product.",
      });
    }

    const packagingConfig = packagingRows[0];

    const boxSize = Number(packagingConfig.box_size);
    const targetQty = Number(order.target_qty || 0);

    if (boxSize <= 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        errorType: "INVALID_MASTER_LABEL_BOX_SIZE",
        message: "Master Label box size must be greater than zero.",
      });
    }

    const requiredMasterLabels = Math.ceil(
      targetQty / boxSize
    );

    // ============================================================
    // 6. Check Production Order Stages
    // ============================================================

    const [stageRows] = await connection.query(
      `
      SELECT
        id,
        stage_id,
        sequence_order,
        next_expected_sequence,
        status
      FROM production_order_stages
      WHERE production_order_id = ?
      ORDER BY sequence_order ASC
      `,
      [id]
    );

    if (stageRows.length === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        errorType: "NO_PRODUCTION_ORDER_STAGES",
        message: "Production order has no configured stages.",
      });
    }

    // ============================================================
    // 7. Initialize Stage Sequence
    //
    // Product QR sequence is local to the Production Order:
    // 1 → 2 → 3 → ... → targetQty
    // ============================================================

    await connection.query(
      `
      UPDATE production_order_stages
      SET
        next_expected_sequence = 1,
        status = 'RUNNING'
      WHERE production_order_id = ?
      `,
      [id]
    );

    // ============================================================
    // 8. Start Production Order
    // ============================================================

    await connection.query(
      `
      UPDATE production_orders
      SET
        status = 'RUNNING',
        started_at = NOW()
      WHERE id = ?
      `,
      [id]
    );

    // ============================================================
    // 9. Commit
    // ============================================================

    await connection.commit();

    // ============================================================
    // 10. Response
    // ============================================================

    return res.status(200).json({
      success: true,
      message: "Production order started successfully",

      data: {
        id: order.id,
        orderNo: order.order_no,

        factoryId: order.factory_id,
        productId: order.product_id,
        lineId: order.line_id,

        status: "RUNNING",

        startedAt: new Date(),

        firstExpectedSequence: 1,

        stageCount: stageRows.length,
        itemCount,

        // Master Label
        masterLabel: {
          boxSize,
          requiredLabels: requiredMasterLabels,
          packagingConfigId: packagingConfig.id,
          printerId: packagingConfig.printer_id,
          labelTemplateId: packagingConfig.label_template_id,
        },
      },
    });

  } catch (error) {

    await connection.rollback();

    console.error(
      "ERR IN START PRODUCTION ORDER:",
      error
    );

    return res.status(500).json({
      success: false,
      message: error.message,
    });

  } finally {

    connection.release();
  }
};

// ============================================================
// Get all Production Orders (list, with filters)
// ============================================================
export const getProductionOrders = async (req, res) => {
  try {
    const {
      status,
      productId,
      factoryId,
      search,
      from,
      to,
    } = req.query;

    
    // get user first 
    
    const [userRows] = await pool.query(
      `
      SELECT id, name, factory_id
      FROM users
      WHERE id = ?
      `,
      [req.user?.id]
    );

    if(userRows.length === 0) {
      console.error("User not found:", req.user);
      return res.status(404).json({
        message: "User not found",
      });
    }
    
    const userFactoryId = userRows[0].factory_id;
    const userRole = req.user?.role;

    const conditions = [];
    const params = [];

    if (userRole === "SYSTEM_ADMIN") {
      // SYSTEM_ADMIN can see all factories

      if (factoryId) {
        conditions.push("po.factory_id = ?");
        params.push(factoryId);
      }

    } else {

      // Normal user must belong to a factory

      if (!userFactoryId) {
        return res.status(400).json({
          message: "User is not assigned to a factory",
        });
      }

      conditions.push("po.factory_id = ?");
      params.push(userFactoryId);
    }

    if (status) {
      conditions.push("po.status = ?");
      params.push(status);
    }

    if (productId) {
      conditions.push("po.product_id = ?");
      params.push(productId);
    }

    if (search?.trim()) {
      conditions.push("po.order_no LIKE ?");
      params.push(`%${search.trim()}%`);
    }

    if (from) {
      conditions.push("po.planned_date >= ?");
      params.push(from);
    }

    if (to) {
      conditions.push("po.planned_date <= ?");
      params.push(to);
    }

    const whereClause =
      conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const [rows] = await pool.query(
      `
      SELECT
        po.id,
        po.order_no,

        po.factory_id,
        f.name AS factory_name,

        po.product_id,
        p.name AS product_name,
        p.erp_no AS product_erp_no,

        PL.id AS line_id,
        PL.name AS line_name,

        po.target_qty,

        po.serial_prefix,
        po.serial_start,
        po.serial_end,
        po.serial_width,

        po.sequence_mode,
        po.status,
        po.planned_date,

        po.started_at,
        po.completed_at,
        po.created_at,

        (
          SELECT COUNT(*)
          FROM production_order_items poi
          WHERE poi.production_order_id = po.id
        ) AS item_count

      FROM production_orders po

      LEFT JOIN products p
        ON p.id = po.product_id

      LEFT JOIN factories f
        ON f.id = po.factory_id

      LEFT JOIN production_lines pl
        ON pl.id = po.line_id

      ${whereClause}

      ORDER BY po.id DESC
      `,
      params
    );

    return res.status(200).json({
      message: "Production orders fetched successfully",
      data: rows,
    });

  } catch (error) {
    console.error(
      "ERR IN GET PRODUCTION ORDERS:",
      error
    );

    return res.status(500).json({
      message: error.message,
    });
  }
};

// ============================================================
// Get single Production Order (with stage flow)
// ============================================================
export const getProductionOrderById = async (req, res) => {
  try {
    const { id } = req.params;

    const [orderRows] = await pool.query(
      `
      SELECT
        po.*,

        p.name AS product_name,
        p.erp_no AS product_erp_no,

        pl.id AS line_id,
        pl.name AS line_name,

        f.name AS factory_name,

        (
          SELECT COUNT(*)
          FROM production_order_items poi
          WHERE poi.production_order_id = po.id
        ) AS item_count

      FROM production_orders po

      LEFT JOIN products p
        ON p.id = po.product_id

      LEFT JOIN factories f
        ON f.id = po.factory_id

      LEFT JOIN production_lines pl
        ON pl.id = po.line_id 

      WHERE po.id = ?
      `,
      [id]
    );

    if (orderRows.length === 0) {
      return res.status(404).json({ message: "Production order not found" });
    }

    const [itemRows] = await pool.query(
      `
        SELECT
          id,
          production_order_id,
          serial_no,
          customer_qr_code,
          sequence_no,
          status,
          rejected_at,
          rejected_by,
          created_at,
          updated_at
        FROM production_order_items
        WHERE production_order_id = ?
        ORDER BY sequence_no ASC, id ASC
      `,
      [id]
    );

    const [stageRows] = await pool.query(
      `
      SELECT
        pos.id,
        pos.stage_id,
        s.name AS stage_name,
        pos.sequence_order,
        pos.next_expected_sequence,
        pos.status
      FROM production_order_stages pos
      INNER JOIN stages s ON s.id = pos.stage_id
      WHERE pos.production_order_id = ?
      ORDER BY pos.sequence_order ASC
      `,
      [id]
    );

    return res.status(200).json({
      message: "Production order fetched successfully",
      data: {
        ...orderRows[0],
        items: itemRows,
        stages: stageRows,
      },
    });
  } catch (error) {
    console.error("ERR IN GET PRODUCTION ORDER BY ID:", error);
    return res.status(500).json({ message: error.message });
  }
};

// ============================================================
// Cancel a Production Order
// ============================================================
export const cancelProductionOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(`SELECT status FROM production_orders WHERE id = ?`, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "Production order not found" });
    }

    if (["COMPLETED", "CANCELLED"].includes(rows[0].status)) {
      return res.status(400).json({
        message: `Order is already ${rows[0].status.toLowerCase()}, cannot cancel`,
      });
    }

    await pool.query(`UPDATE production_orders SET status = 'CANCELLED' WHERE id = ?`, [id]);

    return res.status(200).json({ message: "Production order cancelled successfully" });
  } catch (error) {
    console.error("ERR IN CANCEL PRODUCTION ORDER:", error);
    return res.status(500).json({ message: error.message });
  }
};

export const pauseProductionOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(`SELECT status FROM production_orders WHERE id = ?`, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "Production order not found" });
    }

    if (rows[0].status !== "RUNNING") {
      return res.status(400).json({
        message: `Order must be running to pause (currently ${rows[0].status.toLowerCase()})`,
      });
    }

    await pool.query(`UPDATE production_orders SET status = 'PAUSED' WHERE id = ?`, [id]);

    return res.status(200).json({ message: "Production order paused successfully" });
  } catch (error) {
    console.error("ERR IN PAUSE PRODUCTION ORDER:", error);
    return res.status(500).json({ message: error.message });
  }

};

export const resumeProductionOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(`SELECT status FROM production_orders WHERE id = ?`, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: "Production order not found" });
    }

    if (rows[0].status !== "PAUSED") {
      return res.status(400).json({
        message: `Order must be paused to resume (currently ${rows[0].status.toLowerCase()})`,
      });
    }

    await pool.query(`UPDATE production_orders SET status = 'RUNNING' WHERE id = ?`, [id]);

    return res.status(200).json({ message: "Production order resumed successfully" });
  }

  catch (error) {
    console.error("ERR IN RESUME PRODUCTION ORDER:", error);
    return res.status(500).json({ message: error.message });
  }
};
