import { pool } from "../DB/config/mysql.config.js";


const REUSABLE_ITEMS_SQL = `
  SELECT
    poi.id,
    poi.production_order_id,
    poi.serial_no,
    po.order_no
  FROM production_order_items poi
  INNER JOIN production_orders po
    ON po.id = poi.production_order_id
  WHERE po.status = 'CANCELLED'
    AND po.product_id = ?
    AND po.line_id = ?
    AND poi.status = 'ACTIVE'
    AND NOT EXISTS (
      SELECT 1 FROM scan_history sh
      WHERE sh.scanned_value = poi.serial_no
    )
        AND NOT EXISTS (
      SELECT 1 FROM ict_results ir
      WHERE ir.serial_no = poi.serial_no
    )
    AND NOT EXISTS (
      SELECT 1 FROM production pr
      WHERE pr.serial_no = poi.serial_no
    )
`;


const getIsoYearWeek = (date) => {
  const d = new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    )
  );

  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);

  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));

  const week = Math.ceil(
    (((d - yearStart) / 86400000) + 1) / 7
  );

  return { year, week };
};

const getDatePart = (part, date) => {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");

  switch (part) {
    case "YYYY":
      return yyyy;
    case "YY":
      return yyyy.slice(-2);
    case "MM":
      return mm;
    case "DD":
      return dd;
    case "WW":
      return String(getIsoYearWeek(date).week).padStart(2, "0");
    default:
      throw new Error(`Unsupported date segment: ${part}`);
  }
};

const getProductFieldValue = (field, product) => {
  switch (field) {
    case "name":
      return product.name || "";
    case "part_code":
      return product.part_code || "";
    case "erp_no":
      return product.erp_no || "";
    default:
      throw new Error(`Unsupported product field: ${field}`);
  }
};

const buildProductionSerial = ({ rule, product, serial, date }) => {
  return rule.map((segment) => {
    switch (segment.type) {
      case "STATIC":
        return String(segment.value ?? "");

      case "PRODUCT_FIELD":
        return getProductFieldValue(segment.field, product);

      case "DATE":
        return (segment.parts || [])
          .map((part) => getDatePart(part, date))
          .join("");

      case "SERIAL":
        return String(serial).padStart(Number(segment.width), "0");

      default:
        throw new Error(
          `Unsupported production serial segment: ${segment.type}`
        );
    }
  }).join("");
};


const allocateProductionSerials = async ({
  connection,
  product,
  productId,
  lineId,
  rule,
  serialWidth,
  quantity,
  plannedDate,
  excludeOrderId = null,
}) => {
  
  const dateParts = String(plannedDate).split("-").map(Number);

  if (
    dateParts.length !== 3 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(plannedDate)) ||
    dateParts.some((part) => !Number.isInteger(part))
  ) {
    throw new Error("Invalid production order planned date");
  }

  const [year, month, day] = dateParts;
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error("Invalid production order planned date");
  }


  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("Quantity must be a positive integer");
  }

  if (
    !Number.isInteger(serialWidth) ||
    serialWidth < 1 ||
    serialWidth > 5
  ) {
    throw new Error("Invalid serial width");
  }

  const maxSerial = (10 ** serialWidth) - 1;

  if (quantity > maxSerial) {
    throw new Error(
      `Quantity exceeds serial capacity. Maximum: ${maxSerial}`
    );
  }

  // Ensure one counter exists for this product + line.
  await connection.query(
    `
    INSERT IGNORE INTO production_order_serial_counters
      (product_id, line_id, next_serial)
    VALUES (?, ?, 1)
    `,
    [productId, lineId]
  );

  // Lock the counter within the current transaction.
  const [counterRows] = await connection.query(
    `
    SELECT next_serial
    FROM production_order_serial_counters
    WHERE product_id = ?
      AND line_id = ?
    FOR UPDATE
    `,
    [productId, lineId]
  );

  if (!counterRows.length) {
    throw new Error("Unable to lock the production serial counter");
  }

  let candidate = Number(counterRows[0].next_serial);

  if (
    !Number.isInteger(candidate) ||
    candidate < 1 ||
    candidate > maxSerial
  ) {
    candidate = 1;
  }

  const allocated = [];
  const allocatedSet = new Set();
  let attempts = 0;

  while (allocated.length < quantity && attempts < maxSerial) {
    const serialNo = buildProductionSerial({
      rule,
      product,
      serial: candidate,
      date,
    });

    if (!allocatedSet.has(serialNo)) {
      
      const [existingRows] = await connection.query(
        `
        SELECT 1
        FROM production_order_items poi
        INNER JOIN production_orders po
          ON po.id = poi.production_order_id
        WHERE po.product_id = ?
          AND po.line_id = ?
          AND (? IS NULL OR po.id <> ?)
          AND poi.serial_no = ?
        LIMIT 1
        `,
        [
          productId,
          lineId,
          excludeOrderId,
          excludeOrderId,
          serialNo,
        ]
      );


      const [productionRows] = await connection.query(
        `
        SELECT 1
        FROM production
        WHERE product_id = ?
          AND line_id = ?
          AND serial_no = ?
        LIMIT 1
        `,
        [productId, lineId, serialNo]
      );

      if (!existingRows.length && !productionRows.length) {
        allocated.push({
          serial_no: serialNo,
          serial_value: candidate,
        });

        allocatedSet.add(serialNo);
      }
    }

    candidate = candidate >= maxSerial ? 1 : candidate + 1;
    attempts += 1;
  }

  if (allocated.length !== quantity) {
    throw new Error(
      `Not enough unused serials for this product and line. ` +
      `Requested: ${quantity}, available: ${allocated.length}, ` +
      `serial capacity: ${maxSerial}`
    );
  }

  await connection.query(
    `
    UPDATE production_order_serial_counters
    SET next_serial = ?
    WHERE product_id = ?
      AND line_id = ?
    `,
    [candidate, productId, lineId]
  );

  return allocated;
};



const httpError = (status, message) => Object.assign(new Error(message), { status });

// ------------------------------------------------------------------
// GET /production-orders/reusable-qr?productId=&lineId=
//
// Used by the New Production Order modal to decide whether to ask
// "reuse cancelled QR or use new QR serials?".
// ------------------------------------------------------------------
export const getReusableQr = async (req, res) => {
  try {
    const productId = Number(req.query.productId);
    const lineId = Number(req.query.lineId);

    if (!productId || !lineId) {
      return res.status(400).json({
        message: "productId and lineId are required",
      });
    }

    const [rows] = await pool.query(
      `${REUSABLE_ITEMS_SQL} ORDER BY po.id ASC, poi.id ASC`,
      [productId, lineId]
    );

    const groupMap = new Map();

    for (const row of rows) {
      // One line per serial format (formats differ in length, and within
      // one format the strings sort in serial order).
      const key = `${row.production_order_id}-${row.serial_no.length}`;

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          orderId: row.production_order_id,
          orderNo: row.order_no,
          count: 0,
          from: row.serial_no,
          to: row.serial_no,
        });
      }

      const group = groupMap.get(key);
      group.count += 1;
      if (row.serial_no < group.from) group.from = row.serial_no;
      if (row.serial_no > group.to) group.to = row.serial_no;
    }

    // Fresh QR identities that can still go to this line
    const [freshRows] = await pool.query(
      `
      SELECT COUNT(*) AS count
      FROM production_qr_codes q
      WHERE q.product_id = ?
        AND q.status IN ('GENERATED', 'PRINTED')
        AND NOT EXISTS (
          SELECT 1
          FROM production_order_items poi
          INNER JOIN production_orders po
            ON po.id = poi.production_order_id
          WHERE po.line_id = ?
            AND po.product_id = ?
            AND poi.serial_no = q.qr_data
        )
      `,
      [productId, lineId, productId]
    );

    return res.status(200).json({
      success: true,
      data: {
        availableCount: rows.length,
        groups: Array.from(groupMap.values()),
        freshAvailable: Number(freshRows[0].count),
      },
    });
  } catch (error) {
    console.error("ERR IN GET REUSABLE QR:", error);
    return res.status(500).json({ message: error.message });
  }
};

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

    
    if (plannedDate) {
      const validFormat = /^\d{4}-\d{2}-\d{2}$/.test(plannedDate);

      if (!validFormat) {
        return res.status(400).json({
          message: "Planned Date must be a valid YYYY-MM-DD date",
        });
      }

      const [year, month, day] = plannedDate.split("-").map(Number);
      const dateCheck = new Date(year, month - 1, day);

      if (dateCheck.getFullYear() !== year || dateCheck.getMonth() !== month - 1 || dateCheck.getDate() !== day) {
        return res.status(400).json({
          message: "Planned Date must be a valid YYYY-MM-DD date",
        });
      }
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
      AND s.line_id = psf.line_id
      WHERE psf.product_id = ?
        AND psf.line_id = ?
        AND s.factory_id = ?
        AND s.is_active = 1
      ORDER BY psf.sequence_no ASC
      `,
      [productId, lineId, factoryId]
    );

    if (!stageFlowRows.length) {
      throw new Error(
        "No stage flow configured for this product in this factory"
      );
    }

    // ============================================================
    // GET PRODUCT SERIAL RULE
    //
    // FOR UPDATE doubles as a per-product lock: two people creating
    // orders for the same product are handled one after the other,
    // so they can never be given the same QR identities.
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
      FOR UPDATE
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
    // ============================================================
    // GENERATE SERIALS DIRECTLY FROM THE PRODUCT SERIAL RULE
    // ============================================================

    const now = new Date();

    const effectivePlannedDate = plannedDate ||
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const selectedQr = await allocateProductionSerials({
      connection,
      product,
      productId: Number(productId),
      lineId: Number(lineId),
      rule,
      serialWidth,
      quantity,
      plannedDate: effectivePlannedDate,
    });

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
    // Display only. production_order_items is the source of truth,
    // because reused identities are not always one continuous range.
    // ============================================================

    const firstQr = selectedQr[0];
    const lastQr = selectedQr[selectedQr.length - 1];

    const serialStart = firstQr.serial_value;
    const serialEnd = lastQr.serial_value;

    const serialPrefix =
      firstQr.serial_no.slice(
        0,
        Math.max(0, firstQr.serial_no.length - serialWidth)
      );

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
        effectivePlannedDate,
        req.user?.id || null,
      ]
    );

    const productionOrderId = orderResult.insertId;


    // ============================================================
    // CREATE PRODUCTION ORDER ITEMS
    //
    // sequence_no is LOCAL to this production order (1..quantity).
    // ============================================================

    const itemValues = selectedQr.map((qr, index) => [
      productionOrderId,
      qr.serial_no,
      index + 1,
      "ACTIVE",
    ]);

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
          from: selectedQr[0].serial_no,
          to: selectedQr[selectedQr.length - 1].serial_no,
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

    return res.status(error.status || 500).json({
      message: error.message,
    });
  } finally {
    connection.release();
  }
};

// ------------------------------------------------------------------
// Give serial numbers back after an order was edited to a smaller
// quantity.
//
// The excess items are already deleted by the caller, so those serials
// belong to no order any more. The counter still points past them though,
// so the next order would skip them. When the released serials were the
// most recently handed-out ones (counter = highest released + 1), move the
// counter back to just after the highest serial that is still held by any
// order or by production, so the next order continues from there.
//
// If another order was created after these serials were handed out, the
// counter is left alone (moving it back could collide with that order).
// ------------------------------------------------------------------
const releaseSerialsToCounter = async (
  conn,
  { productId, lineId, serialWidth, releasedItems }
) => {
  const suffixes = releasedItems
    .map((item) => Number(String(item.serial_no).slice(-serialWidth)))
    .filter((value) => Number.isInteger(value));

  if (!suffixes.length) return;

  const maxReleased = Math.max(...suffixes);
  const prefix = String(releasedItems[0].serial_no).slice(0, -serialWidth);
  const serialLength = prefix.length + serialWidth;

  await conn.query(
    `
    INSERT IGNORE INTO production_order_serial_counters
      (product_id, line_id, next_serial)
    VALUES (?, ?, 1)
    `,
    [productId, lineId]
  );

  const [counterRows] = await conn.query(
    `
    SELECT next_serial
    FROM production_order_serial_counters
    WHERE product_id = ? AND line_id = ?
    FOR UPDATE
    `,
    [productId, lineId]
  );

  if (!counterRows.length) return;

  const counter = Number(counterRows[0].next_serial);

  // Something was allocated after these serials, so they are not the tail.
  if (counter !== maxReleased + 1) return;

  // Highest serial (same prefix = same date/week format) still in use.
  const [heldRows] = await conn.query(
    `
    SELECT COALESCE(MAX(held.n), 0) AS max_held
    FROM (
      SELECT CAST(RIGHT(poi.serial_no, ?) AS UNSIGNED) AS n
      FROM production_order_items poi
      INNER JOIN production_orders po
        ON po.id = poi.production_order_id
      WHERE po.product_id = ?
        AND po.line_id = ?
        AND CHAR_LENGTH(poi.serial_no) = ?
        AND LEFT(poi.serial_no, ?) = ?

      UNION ALL

      SELECT CAST(RIGHT(pr.serial_no, ?) AS UNSIGNED) AS n
      FROM production pr
      WHERE pr.product_id = ?
        AND pr.line_id = ?
        AND CHAR_LENGTH(pr.serial_no) = ?
        AND LEFT(pr.serial_no, ?) = ?
    ) held
    `,
    [
      serialWidth, productId, lineId, serialLength, prefix.length, prefix,
      serialWidth, productId, lineId, serialLength, prefix.length, prefix,
    ]
  );

  const nextSerial = Number(heldRows[0].max_held) + 1;

  if (nextSerial < counter) {
    await conn.query(
      `
      UPDATE production_order_serial_counters
      SET next_serial = ?
      WHERE product_id = ? AND line_id = ?
      `,
      [nextSerial, productId, lineId]
    );
  }
};

export const updateProductionOrder = async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    connection = await pool.getConnection();

    const { id } = req.params;
    const {
      productId,
      lineId,
      targetQty,
      sequenceMode = "NON_SEQUENTIAL",
      plannedDate,
    } = req.body;

    // 1. Validate request
    const orderId = Number(id);
    const selectedProductId = Number(productId);
    const selectedLineId = Number(lineId);
    const quantity = Number(targetQty);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({
        message: "Invalid production order ID",
      });
    }

    if (!Number.isInteger(selectedProductId) || selectedProductId <= 0) {
      return res.status(400).json({
        message: "Valid product is required",
      });
    }

    if (!Number.isInteger(selectedLineId) || selectedLineId <= 0) {
      return res.status(400).json({
        message: "Valid production line is required",
      });
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({
        message: "Target quantity must be a positive whole number",
      });
    }

    if (!["SEQUENTIAL", "NON_SEQUENTIAL"].includes(sequenceMode)) {
      return res.status(400).json({
        message: "Invalid sequence mode",
      });
    }

    const isValidDate = (value) => {
      if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value)
      ) {
        return false;
      }

      const [year, month, day] = value.split("-").map(Number);
      const date = new Date(year, month - 1, day);

      return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
      );
    };

    if (
      plannedDate !== undefined &&
      plannedDate !== null &&
      plannedDate !== "" &&
      !isValidDate(plannedDate)
    ) {
      return res.status(400).json({
        message: "Planned date must be a valid YYYY-MM-DD date",
      });
    }

    const now = new Date();
    const today =
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // 2. Validate user's factory
    const [userRows] = await connection.query(
      `SELECT factory_id FROM users WHERE id = ?`,
      [req.user?.id || null]
    );

    if (!userRows.length || !userRows[0].factory_id) {
      return res.status(400).json({
        message: "User is not assigned to a factory",
      });
    }

    const factoryId = Number(userRows[0].factory_id);

    // 3. Lock the existing order
    await connection.beginTransaction();
    transactionStarted = true;

    const [existingRows] = await connection.query(
      `
      SELECT
        id,
        factory_id,
        product_id,
        line_id,
        status,
        planned_date
      FROM production_orders
      WHERE id = ?
      FOR UPDATE
      `,
      [orderId]
    );

    if (!existingRows.length) {
      throw Object.assign(
        new Error("Production order not found"),
        { status: 404 }
      );
    }

    const existingOrder = existingRows[0];

    if (Number(existingOrder.factory_id) !== factoryId) {
      throw Object.assign(
        new Error("You cannot edit an order outside your assigned factory"),
        { status: 403 }
      );
    }

    if (existingOrder.status !== "PLANNED") {
      throw Object.assign(
        new Error(
          `Order cannot be edited because it is already ${String(existingOrder.status).toLowerCase()}`
        ),
        { status: 400 }
      );
    }

    // Do not change product or line on an existing order.
    if (
      Number(existingOrder.product_id) !== selectedProductId ||
      Number(existingOrder.line_id) !== selectedLineId
    ) {
      throw Object.assign(
        new Error(
          "Product and production line cannot be changed on an existing order. Create a new production order instead."
        ),
        { status: 400 }
      );
    }

    const effectivePlannedDate =
      plannedDate ||
      (existingOrder.planned_date
        ? String(existingOrder.planned_date).slice(0, 10)
        : today);

    if (!isValidDate(effectivePlannedDate)) {
      throw Object.assign(
        new Error("The existing planned date is invalid"),
        { status: 400 }
      );
    }

    // 4. Validate product
    const [productRows] = await connection.query(
      `
      SELECT id, name, part_code, erp_no
      FROM products
      WHERE id = ? AND is_active = 1
      LIMIT 1
      `,
      [selectedProductId]
    );

    if (!productRows.length) {
      throw Object.assign(
        new Error("Product not found or inactive"),
        { status: 400 }
      );
    }

    const product = productRows[0];

    // 5. Validate production line
    const [lineRows] = await connection.query(
      `
      SELECT id, name, factory_id
      FROM production_lines
      WHERE id = ?
        AND factory_id = ?
        AND is_active = 1
      LIMIT 1
      `,
      [selectedLineId, factoryId]
    );

    if (!lineRows.length) {
      throw Object.assign(
        new Error("Production line not found in user's factory"),
        { status: 400 }
      );
    }

    // 6. Validate the product's stage flow for this line.
    const [stageFlowRows] = await connection.query(
      `
      SELECT psf.stage_id, psf.sequence_no
      FROM product_stage_flow psf
      INNER JOIN stages s
        ON s.id = psf.stage_id
       AND s.line_id = psf.line_id
      WHERE psf.product_id = ?
        AND psf.line_id = ?
        AND s.factory_id = ?
        AND s.is_active = 1
      ORDER BY psf.sequence_no ASC
      `,
      [selectedProductId, selectedLineId, factoryId]
    );

    if (!stageFlowRows.length) {
      throw Object.assign(
        new Error("No stage flow configured for this product and line"),
        { status: 400 }
      );
    }

    // 7. Lock and read the active serial rule.
    const [serialRuleRows] = await connection.query(
      `
      SELECT id, product_id, rule, is_active
      FROM production_serial_rules
      WHERE product_id = ?
        AND is_active = 1
      LIMIT 1
      FOR UPDATE
      `,
      [selectedProductId]
    );

    if (!serialRuleRows.length) {
      throw Object.assign(
        new Error("No active production serial rule configured for this product"),
        { status: 400 }
      );
    }

    const serialRule = serialRuleRows[0];

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
      throw new Error("Production serial rule has an invalid SERIAL width");
    }

    const maxSerial = 10 ** serialWidth - 1;

    if (quantity > maxSerial) {
      throw Object.assign(
        new Error(`Quantity exceeds serial capacity. Maximum: ${maxSerial}`),
        { status: 400 }
      );
    }

    // 8. Load this order's existing serial assignments.
    const [existingItemRows] = await connection.query(
      `
      SELECT id, serial_no, sequence_no, status
      FROM production_order_items
      WHERE production_order_id = ?
      ORDER BY sequence_no ASC, id ASC
      FOR UPDATE
      `,
      [orderId]
    );

    // Keep the existing serials first.
    const retainedItems = existingItemRows.slice(0, quantity);
    const excessItems = existingItemRows.slice(quantity);
    const additionalQty = quantity - retainedItems.length;

    const retainedSerials = new Set(
      retainedItems.map((item) => item.serial_no)
    );

    const additionalSerials = [];

    // 9. Allocate only the missing quantity.
    // Search from 1 upward so released serials can be reused.
    if (additionalQty > 0) {
      await connection.query(
        `
        INSERT IGNORE INTO production_order_serial_counters
          (product_id, line_id, next_serial)
        VALUES (?, ?, 1)
        `,
        [selectedProductId, selectedLineId]
      );

      const [counterRows] = await connection.query(
        `
        SELECT next_serial
        FROM production_order_serial_counters
        WHERE product_id = ? AND line_id = ?
        FOR UPDATE
        `,
        [selectedProductId, selectedLineId]
      );

      if (!counterRows.length) {
        throw new Error("Unable to lock the production serial counter");
      }

      const dateParts = effectivePlannedDate.split("-").map(Number);
      const [year, month, day] = dateParts;
      const serialDate = new Date(year, month - 1, day);

      const retainedSuffixes = retainedItems.map((item) =>
        Number(item.serial_no.slice(-serialWidth))
      );

      let candidate = retainedSuffixes.length
        ? Math.max(...retainedSuffixes) + 1
        : 1;
      let attempts = 0;

      while (
        additionalSerials.length < additionalQty &&
        attempts < maxSerial
      ) {
        const serialNo = buildProductionSerial({
          rule,
          product,
          serial: candidate,
          date: serialDate,
        });

        if (!retainedSerials.has(serialNo)) {
          const [assignedRows] = await connection.query(
            `
            SELECT 1
            FROM production_order_items poi
            INNER JOIN production_orders po
              ON po.id = poi.production_order_id
            WHERE po.product_id = ?
              AND po.line_id = ?
              AND po.id <> ?
              AND poi.serial_no = ?
            LIMIT 1
            `,
            [
              selectedProductId,
              selectedLineId,
              orderId,
              serialNo,
            ]
          );

          const [usedRows] = await connection.query(
            `
            SELECT 1
            FROM production
            WHERE product_id = ?
              AND line_id = ?
              AND serial_no = ?
            LIMIT 1
            `,
            [selectedProductId, selectedLineId, serialNo]
          );

          if (!assignedRows.length && !usedRows.length) {
            additionalSerials.push({
              serial_no: serialNo,
              serial_value: candidate,
            });
          }
        }

        candidate = candidate >= maxSerial ? 1 : candidate + 1;
        attempts += 1;
      }

      if (additionalSerials.length !== additionalQty) {
        throw Object.assign(
          new Error(
            `Insufficient available serials. Required additional: ${additionalQty}, available: ${additionalSerials.length}`
          ),
          { status: 409 }
        );
      }

      // Keep the counter as a hint for other code paths.
      // Allocation itself searches for the lowest available serial.
      await connection.query(
        `
        UPDATE production_order_serial_counters
        SET next_serial = ?
        WHERE product_id = ? AND line_id = ?
        `,
        [candidate, selectedProductId, selectedLineId]
      );
    }

    const finalSerials = [
      ...retainedItems.map((item) => ({
        serial_no: item.serial_no,
      })),
      ...additionalSerials.map((item) => ({
        serial_no: item.serial_no,
      })),
    ];

    const firstSerial = finalSerials[0];
    const lastSerial = finalSerials[finalSerials.length - 1];

    const serialNumbers = finalSerials.map((item) =>
      Number(item.serial_no.slice(-serialWidth))
    );

    const serialStart = Math.min(...serialNumbers);
    const serialEnd = Math.max(...serialNumbers);

    const serialPrefix = firstSerial.serial_no.slice(
      0,
      Math.max(0, firstSerial.serial_no.length - serialWidth)
    );

    // 10. Update the order.
    await connection.query(
      `
      UPDATE production_orders
      SET target_qty = ?,
          serial_prefix = ?,
          serial_start = ?,
          serial_end = ?,
          serial_width = ?,
          sequence_mode = ?,
          planned_date = ?
      WHERE id = ?
      `,
      [
        quantity,
        serialPrefix,
        serialStart,
        serialEnd,
        serialWidth,
        sequenceMode,
        effectivePlannedDate,
        orderId,
      ]
    );

    // 11. Delete only the excess items and release their serial numbers,
    // so the next order can use them again (the order is still PLANNED,
    // so there is no history to keep).
    if (excessItems.length > 0) {
      const excessIds = excessItems.map((item) => item.id);
      const placeholders = excessIds.map(() => "?").join(",");

      await connection.query(
        `
        DELETE FROM production_order_items
        WHERE production_order_id = ?
          AND id IN (${placeholders})
        `,
        [orderId, ...excessIds]
      );

      await releaseSerialsToCounter(connection, {
        productId: selectedProductId,
        lineId: selectedLineId,
        serialWidth,
        releasedItems: excessItems,
      });
    }

    // Insert only newly allocated serials.
    if (additionalSerials.length > 0) {
      const itemValues = additionalSerials.map((serial, index) => [
        orderId,
        serial.serial_no,
        retainedItems.length + index + 1,
        "ACTIVE",
      ]);

      await connection.query(
        `
        INSERT INTO production_order_items
          (production_order_id, serial_no, sequence_no, status)
        VALUES ?
        `,
        [itemValues]
      );
    }

    // Do not delete or recreate production_order_stages.
    // The existing stage snapshots are preserved.

    // 12. Commit.
    await connection.commit();
    transactionStarted = false;

    return res.status(200).json({
      message: "Production order updated successfully",
      data: {
        id: orderId,
        productId: selectedProductId,
        productName: product.name,
        lineId: selectedLineId,
        lineName: lineRows[0].name,
        targetQty: quantity,
        serialPrefix,
        serialStart,
        serialEnd,
        serialWidth,
        serialRuleId: serialRule.id,
        qrRange: {
          from: firstSerial.serial_no,
          to: lastSerial.serial_no,
        },
        sequenceMode,
        plannedDate: effectivePlannedDate,
        status: "PLANNED",
        stageCount: stageFlowRows.length,
      },
    });
  } catch (error) {
    if (connection && transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("ERR IN UPDATE PRODUCTION ORDER:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Production order or serial number already exists",
      });
    }

    return res.status(error.status || 500).json({
      message: error.message || "Failed to update production order",
    });
  } finally {
    if (connection) {
      connection.release();
    }
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
    //    (only if the product has a packaging stage)
    //
    // No active packaging_config = no packaging stage, so no
    // Master Labels are needed and the order starts normally.
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

    const targetQty = Number(order.target_qty || 0);

    let masterLabel = null;

    if (packagingRows.length) {
      const packagingConfig = packagingRows[0];
      const boxSize = Number(packagingConfig.box_size);

      if (!(boxSize > 0)) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          errorType: "INVALID_MASTER_LABEL_BOX_SIZE",
          message: "Master Label box size must be greater than zero.",
        });
      }

      masterLabel = {
        boxSize,
        requiredLabels: Math.ceil(targetQty / boxSize),
        packagingConfigId: packagingConfig.id,
        printerId: packagingConfig.printer_id,
        labelTemplateId: packagingConfig.label_template_id,
      };
    }

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

        // Master Label (null when the product has no packaging stage)
        masterLabel,
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

// GET /production-orders/:id/items?page=1&pageSize=50&status=PENDING&search=PS0012
export const getProductionOrderItems = async (req, res) => {
  try {
    const { id } = req.params;

    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 50, 1), 100);
    const offset = (page - 1) * pageSize;

    const status = req.query.status || null; // PENDING | IN_PROGRESS | COMPLETED | REJECTED
    const search = String(req.query.search || "").trim();

    // One row per serial with its progress. Assumes one row per serial in
    // `production` (index production.serial_no).
    const baseSql = `
      SELECT
        poi.sequence_no,
        poi.serial_no,
        CASE
          WHEN poi.status = 'REJECTED' THEN 'REJECTED'
          ELSE COALESCE(pr.status, 'PENDING')
        END AS status
      FROM production_order_items poi
      LEFT JOIN production pr
        ON pr.serial_no = poi.serial_no
      WHERE poi.production_order_id = ?
    `;

    const filters = [];
    const filterParams = [];

    if (status) {
      filters.push("t.status = ?");
      filterParams.push(status);
    }

    if (search) {
      filters.push("t.serial_no LIKE ?");
      filterParams.push(`%${search}%`);
    }

    const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const [
      [itemRows],
      [countRows],
      [summaryRows],
      [firstRows],
      [lastRows],
    ] = await Promise.all([
      pool.query(
        `SELECT t.sequence_no, t.serial_no, t.status
         FROM (${baseSql}) t
         ${whereSql}
         ORDER BY t.sequence_no ASC
         LIMIT ? OFFSET ?`,
        [id, ...filterParams, pageSize, offset]
      ),
      pool.query(
        `SELECT COUNT(*) AS total FROM (${baseSql}) t ${whereSql}`,
        [id, ...filterParams]
      ),
      pool.query(
        `SELECT t.status, COUNT(*) AS count
         FROM (${baseSql}) t
         GROUP BY t.status`,
        [id]
      ),
      pool.query(
        `SELECT serial_no FROM production_order_items
         WHERE production_order_id = ?
         ORDER BY sequence_no ASC LIMIT 1`,
        [id]
      ),
      pool.query(
        `SELECT serial_no FROM production_order_items
         WHERE production_order_id = ?
         ORDER BY sequence_no DESC LIMIT 1`,
        [id]
      ),
    ]);

    const summary = { PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0, REJECTED: 0 };
    summaryRows.forEach((row) => {
      summary[row.status] = Number(row.count);
    });

    return res.status(200).json({
      success: true,
      data: {
        items: itemRows,
        total: Number(countRows[0].total),
        page,
        pageSize,
        summary,
        first_serial: firstRows[0]?.serial_no || null,
        last_serial: lastRows[0]?.serial_no || null,
      },
    });
  } catch (error) {
    console.error("ERR IN GET PRODUCTION ORDER ITEMS:", error);
    return res.status(500).json({ message: error.message });
  }
};


export const getMyLineProductionOrders = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authenticated user not found",
      });
    }

    // Always derive the user's production context from the database.
    const [userRows] = await pool.query(
      `
      SELECT factory_id, line_id, stage_id
      FROM users
      WHERE id = ?
      LIMIT 1
      `,
      [userId]
    );

    if (!userRows.length) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const { factory_id, line_id, stage_id } = userRows[0];

    if (!factory_id || !line_id || !stage_id) {
      return res.status(403).json({
        success: false,
        message:
          "Your factory, production line, or stage assignment is missing.",
      });
    }

    const [orders] = await pool.query(
      `
      SELECT
        po.id AS production_order_id,
        po.order_no AS production_order_no,
        po.product_id,
        p.name AS product_name,
        p.erp_no,
        p.part_code,
        po.factory_id,
        po.line_id,
        pl.name AS line_name,
        po.target_qty,
        COALESCE(sh.achieved_qty, 0) AS achieved_qty,
        GREATEST(
          po.target_qty - COALESCE(sh.achieved_qty, 0),
          0
        ) AS remaining_qty,
        po.status AS production_order_status,
        po.planned_date
      FROM production_orders po
      INNER JOIN products p
        ON p.id = po.product_id
      LEFT JOIN production_lines pl
        ON pl.id = po.line_id
      LEFT JOIN (
        SELECT
          production_order_id,
          COUNT(DISTINCT scanned_value) AS achieved_qty
        FROM scan_history
        WHERE stage_id = ?
          AND status = 'SUCCESS'
          AND production_order_id IS NOT NULL
        GROUP BY production_order_id
      ) sh
        ON sh.production_order_id = po.id
      WHERE po.factory_id = ?
        AND po.line_id = ?
        AND po.status = 'RUNNING'
        AND p.is_active = 1
        AND EXISTS (
          SELECT 1
          FROM production_order_stages pos
          WHERE pos.production_order_id = po.id
            AND pos.stage_id = ?
        )
      ORDER BY po.id DESC
      `,
      [stage_id, factory_id, line_id, stage_id]
    );

    return res.status(200).json({
      success: true,
      message: "Production orders for your line fetched successfully",
      context: {
        factoryId: factory_id,
        lineId: line_id,
        stageId: stage_id,
      },
      count: orders.length,
      data: orders,
    });
  } catch (error) {
    console.error("ERR IN GET MY LINE PRODUCTION ORDERS:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch production orders for your line",
      error: error.message,
    });
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
