import { pool } from "../DB/config/mysql.config.js";

export const createProductionOrder = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const {
      productId,
      lineId,
      targetQty,
      serialPrefix,
      serialStart,
      serialEnd,
      serialWidth = 5,
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
    // VALIDATION
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

    if (!serialPrefix?.trim()) {
      return res.status(400).json({
        message: "Serial prefix is required",
      });
    }

    if (
      serialStart === undefined ||
      serialStart === null ||
      serialEnd === undefined ||
      serialEnd === null
    ) {
      return res.status(400).json({
        message: "Serial start and serial end are required",
      });
    }

    if (Number(serialStart) > Number(serialEnd)) {
      return res.status(400).json({
        message: "Serial start cannot be greater than serial end",
      });
    }

    const calculatedQty =Number(serialEnd) - Number(serialStart) + 1;

    if (calculatedQty !== Number(targetQty)) {
      return res.status(400).json({
        message: "Target quantity must match the serial range",
        calculatedQty,
        targetQty: Number(targetQty),
      });
    }

    if (!["SEQUENTIAL", "NON_SEQUENTIAL"].includes(sequenceMode)) {
      return res.status(400).json({
        message: "sequenceMode must be SEQUENTIAL or NON_SEQUENTIAL",
      });
    }

    if (!serialWidth || Number(serialWidth) <= 0) {
      return res.status(400).json({
        message: "Valid serial width is required",
      });
    }

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
      await connection.rollback();

      return res.status(404).json({
        message: "Factory not found",
      });
    }

    // ============================================================
    // VALIDATE PRODUCT
    // ============================================================

    const [productRows] = await connection.query(
      `
      SELECT id, name, erp_no
      FROM products
      WHERE id = ?
        AND is_active = 1
      `,
      [productId]
    );

    if (!productRows.length) {
      await connection.rollback();

      return res.status(404).json({
        message: "Product not found",
      });
    }

    // ============================================================
    // VALIDATE PRODUCTION LINE
    // ============================================================

    const [lineRows] = await connection.query(
      `
      SELECT id, name, factory_id
      FROM production_lines
      WHERE id = ?
        AND factory_id = ?
      `,
      [lineId, factoryId]
    );

    if (!lineRows.length) {
      await connection.rollback();

      return res.status(404).json({
        message: "Production line not found in user's factory",
      });
    }

    // ============================================================
    // GET PRODUCT STAGE FLOW FOR THIS FACTORY
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
      await connection.rollback();

      return res.status(400).json({
        message:"No stage flow configured for this product in this factory",
      });
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

    if (orderRows.length > 0) {
      const lastOrderNo = orderRows[0].order_no;

      const lastNumber = parseInt(
        lastOrderNo.split("-").pop(),
        10
      );

      orderNumber = lastNumber + 1;
    }

    const orderNo =`${datePrefix}${String(orderNumber).padStart(3, "0")}`;

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
        targetQty,
        serialPrefix.trim(),
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
    // ============================================================

    const itemValues = [];

    for (
      let sequence = Number(serialStart);
      sequence <= Number(serialEnd);
      sequence++
    ) {
      const serialSequence = String(sequence).padStart(
        Number(serialWidth),
        "0"
      );

      const serialNo =
        `${serialPrefix.trim()}${serialSequence}`;

      itemValues.push([
        productionOrderId,
        serialNo,
        sequence,
        "ACTIVE",
      ]);
    }

    if (itemValues.length > 0) {
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
      serialStart,
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

    return res.status(201).json({
      message: "Production order created successfully",

      data: {
        id: productionOrderId,
        orderNo,

        factoryId,
        factoryName: factoryRows[0].name,

        productId,

        lineId,
        lineName: lineRows[0].name,

        targetQty: Number(targetQty),

        serialPrefix: serialPrefix.trim(),
        serialStart: Number(serialStart),
        serialEnd: Number(serialEnd),
        serialWidth: Number(serialWidth),

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
        message: "Production order already exists",
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
      serialPrefix,
      serialStart,
      serialEnd,
      serialWidth = 5,
      sequenceMode = "NON_SEQUENTIAL",
      plannedDate,
    } = req.body;

    // ============================================================
    // Validation (same rules as create)
    // ============================================================

    if (!productId) {
      return res.status(400).json({ message: "Product is required" });
    }

    if (!lineId) {
      return res.status(400).json({ message: "Production line is required" });
    }

    if (!targetQty || targetQty <= 0) {
      return res.status(400).json({ message: "Valid target quantity is required" });
    }

    if (!serialPrefix?.trim()) {
      return res.status(400).json({ message: "Serial prefix is required" });
    }

    if (
      serialStart === undefined ||
      serialStart === null ||
      serialEnd === undefined ||
      serialEnd === null
    ) {
      return res.status(400).json({ message: "Serial start and serial end are required" });
    }

    if (serialStart > serialEnd) {
      return res.status(400).json({ message: "Serial start cannot be greater than serial end" });
    }

    const calculatedQty = serialEnd - serialStart + 1;

    if (calculatedQty !== Number(targetQty)) {
      return res.status(400).json({
        message: "Target quantity must match the serial range",
        calculatedQty,
        targetQty: Number(targetQty),
      });
    }

    if (!["SEQUENTIAL", "NON_SEQUENTIAL"].includes(sequenceMode)) {
      return res.status(400).json({
        message: "sequenceMode must be SEQUENTIAL or NON_SEQUENTIAL",
      });
    }

    if (!serialWidth || serialWidth <= 0) {
      return res.status(400).json({ message: "Valid serial width is required" });
    }

    await connection.beginTransaction();

    // ============================================================
    // Lock and validate the existing order
    // ============================================================

    const [existingRows] = await connection.query(
      `
      SELECT id, status
      FROM production_orders
      WHERE id = ?
      FOR UPDATE
      `,
      [id]
    );

    if (existingRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Production order not found" });
    }

    if (existingRows[0].status !== "PLANNED") {
      await connection.rollback();
      return res.status(400).json({
        message: `Order cannot be edited because it is already ${existingRows[0].status.toLowerCase()}`,
      });
    }

    // ============================================================
    // Validate Product
    // ============================================================

    const [productRows] = await connection.query(
      `
      SELECT id
      FROM products
      WHERE id = ?
        AND is_active = 1
      `,
      [productId]
    );

    if (productRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Product not found" });
    }

    // Get user's factory
    const [userRows] = await connection.query(
      `
      SELECT factory_id
      FROM users
      WHERE id = ?
      `,
      [req.user?.id || null]
    );

    if (!userRows.length || !userRows[0].factory_id) {
      await connection.rollback();

      return res.status(400).json({
        message: "User is not assigned to a factory",
      });
    }

    const factoryId = userRows[0].factory_id;

    // ============================================================
    // Validate Production Line
    // ============================================================

    const [lineRows] = await connection.query(
      `
      SELECT id
      FROM production_lines
      WHERE id = ?
      AND factory_id = ?
      `,
      [lineId, factoryId]
    );

    if (lineRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Production line not found" });
    }

    // ============================================================
    // Get Product Stage Flow (product may have changed)
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

    if (stageFlowRows.length === 0) {
      await connection.rollback();
      return res.status(400).json({ message: "No stage flow configured for this product" });
    }

    // ============================================================
    // Update Production Order row
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
        targetQty,
        serialPrefix.trim(),
        serialStart,
        serialEnd,
        serialWidth,
        sequenceMode,
        plannedDate || new Date(),
        id,
      ]
    );

    // ============================================================
    // Wipe and regenerate items + stages
    // ============================================================

    await connection.query(
      `DELETE FROM production_order_items WHERE production_order_id = ?`,
      [id]
    );

    await connection.query(
      `DELETE FROM production_order_stages WHERE production_order_id = ?`,
      [id]
    );

    const itemValues = [];

    for (let sequence = Number(serialStart); sequence <= Number(serialEnd); sequence++) {
      const serialSequence = String(sequence).padStart(Number(serialWidth), "0");
      const serialNo = `${serialPrefix.trim()}${serialSequence}`;

      itemValues.push([id, serialNo, sequence, "ACTIVE"]);
    }

    if (itemValues.length > 0) {
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

    const stageValues = stageFlowRows.map((stage) => [
      id,
      stage.stage_id,
      stage.sequence_no,
      serialStart,
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

    await connection.commit();

    return res.status(200).json({
      message: "Production order updated successfully",
      data: {
        id: Number(id),
        productId,
        lineId,
        targetQty: Number(targetQty),
        serialPrefix: serialPrefix.trim(),
        serialStart: Number(serialStart),
        serialEnd: Number(serialEnd),
        serialWidth: Number(serialWidth),
        sequenceMode,
        status: "PLANNED",
        stageCount: stageFlowRows.length,
      },
    });
  } catch (error) {
    await connection.rollback();

    console.error("ERR IN UPDATE PRODUCTION ORDER:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Production order already exists" });
    }

    return res.status(500).json({ message: error.message });
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
        message: `Production order cannot be started because it is already ${order.status.toLowerCase()}.`,
      });
    }

    // ============================================================
    // 3. Prevent Multiple RUNNING Orders
    //    Same Factory + Same Product + Same Line
    //    (the same product CAN run simultaneously on different
    //    lines within the same factory — only the same line is
    //    restricted to one active order at a time)
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
        message:
          "Production order has no generated serial items.",
      });
    }

    // ============================================================
    // 5. Check Production Order Stages
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
        message:
          "Production order has no configured stages.",
      });
    }

    // ============================================================
    // 6. Initialize Stage Sequence
    // ============================================================

    await connection.query(
      `
      UPDATE production_order_stages
      SET
        next_expected_sequence = ?,
        status = 'RUNNING'
      WHERE production_order_id = ?
      `,
      [
        order.serial_start,
        id,
      ]
    );

    // ============================================================
    // 7. Start Production Order
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
    // 8. Commit
    // ============================================================

    await connection.commit();

    // ============================================================
    // 9. Response
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

        firstExpectedSequence:
          order.serial_start,

        stageCount:
          stageRows.length,

        itemCount,
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
      data: { ...orderRows[0], stages: stageRows },
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
