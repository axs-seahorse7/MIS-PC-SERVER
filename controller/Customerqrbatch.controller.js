import { pool } from '../DB/config/mysql.config.js'; // adjust to your actual pool import path
import { AppError, asyncHandler } from '../utils/AppError.js';
import { buildCustomerQrBatchZpl } from '../utils/Zplbuilder.customerqr.js';


const CHUNK_SIZE = 2000; // rows per INSERT, to keep queries reasonably sized

const getIsoYearWeek = (date = new Date()) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  const yy = Number(String(d.getUTCFullYear()).slice(-2));
  return { yy, week };
};

const buildSerialString = (partCode, serialNo, yy, week, width) =>
  `${partCode}${String(yy).padStart(2, '0')}${String(week).padStart(2, '0')}${String(serialNo).padStart(width, '0')}`;

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// ---------------------------------------------------------------------
// GET /:id/generation-preview
// Powers the "Generate Customer QR Labels" modal — read-only, doesn't
// touch the bucket or reserve anything.
// ---------------------------------------------------------------------
export const getGenerationPreview = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [ruleRows] = await pool.query(
    `SELECT
       r.*,
       p.name AS product_name,
       p.part_code AS product_part_code,
       p.erp_no AS product_erp_no
     FROM customer_serial_rules r
     LEFT JOIN products p
       ON p.id = r.product_id
     WHERE r.id = ?`,
    [id]
  );

  if (!ruleRows.length) {
    throw new AppError(
      'Customer serial rule not found',
      404
    );
  }

  const rule = ruleRows[0];

  if (!rule.is_active) {
    throw new AppError(
      'This rule is inactive',
      409
    );
  }

  if (!rule.product_name) {
    throw new AppError(
      'Product configured for this rule was not found',
      404
    );
  }

  // ------------------------------------------------------------
  // Current ISO year/week
  // ------------------------------------------------------------

  const { yy, week } = getIsoYearWeek();

  const maxSerial =
    10 ** Number(rule.serial_width) - 1;

  // ------------------------------------------------------------
  // Current week's bucket
  // ------------------------------------------------------------

  const [bucketRows] = await pool.query(
    `SELECT
       b.id,
       b.next_serial,
       b.start_serial,
       b.end_serial,
       b.generated_qty,
       b.printer_id,
       p.name AS printer_name,
       p.printer_name AS printer_queue_name
     FROM customer_qr_buckets b
     LEFT JOIN printers p
       ON p.id = b.printer_id
     WHERE b.rule_id = ?
       AND b.year = ?
       AND b.week = ?
     LIMIT 1`,
    [id, yy, week]
  );

  const bucket = bucketRows[0];

  const availableFrom = bucket
    ? Number(bucket.next_serial)
    : 1;

  const availableTo = maxSerial;

  const availableCount = Math.max(
    availableTo - availableFrom + 1,
    0
  );

  // ------------------------------------------------------------
  // Response
  // ------------------------------------------------------------

  res.json({
    data: {
      customer_name: rule.customer_name,

      // Product information
      product_name: rule.product_name,
      product_part_code: rule.product_part_code,
      product_erp_no: rule.product_erp_no,

      // Customer QR generation prefix
      // Example: PS00695
      part_code: rule.part_code,

      serial_width: rule.serial_width,

      year: yy,
      week,

      current_bucket:
        `${String(yy).padStart(2, '0')}-W` +
        `${String(week).padStart(2, '0')}`,

      // Serial availability
      available_from: availableFrom,
      available_to: availableTo,
      available_count: availableCount,

      // Existing bucket information
      bucket_id: bucket?.id ?? null,
      generated_qty: bucket?.generated_qty ?? 0,

      // Previously selected printer
      printer_id: bucket?.printer_id ?? null,
      printer_name: bucket?.printer_name ?? null,
      printer_queue_name:
        bucket?.printer_queue_name ?? null,
    },
  });
});

// ---------------------------------------------------------------------
// POST /:id/generate-batch  { quantity }
//
// 1. Lock customer serial rule
// 2. Check current YY + WEEK
// 3. Check requested quantity
// 4. Check max (10^serial_width - 1)
// 5. Reserve serial range (on the week's bucket)
// 6. Create QR records
// 7. Generate printer data (ZPL)
//
// Steps 8-9 (send to printer, mark PRINTED) happen client-side via QZ
// Tray, then a follow-up call to markCustomerQrCodesPrinted — printing
// is a browser-to-local-printer action, not something the backend can
// do directly.
// ---------------------------------------------------------------------
export const generateCustomerQrBatch = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const MAX_BATCH_QUANTITY = 500;

  const quantity = Number(req.body.quantity);
  const printerId = req.body.printer_id;
  const templateId = req.body.template_id;

  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new AppError('quantity must be a positive integer', 400);
  }

  if (quantity > MAX_BATCH_QUANTITY) {
    throw new AppError(
      `Maximum ${MAX_BATCH_QUANTITY} customer QR codes can be generated at once.`,
      400
    );
  }

  if (!printerId) {
    throw new AppError('printer_id is required', 400);
  }

  if (!templateId) {
    throw new AppError('template_id is required', 400);
  }

  // ------------------------------------------------------------
  // Validate printer
  // ------------------------------------------------------------

  const [printerRows] = await pool.query(
    `SELECT id, name, printer_name
     FROM printers
     WHERE id = ?
       AND is_active = 1`,
    [printerId]
  );

  if (!printerRows.length) {
    throw new AppError(
      'Selected printer not found or inactive',
      404
    );
  }

  const printer = printerRows[0];

  if (!printer.printer_name) {
    throw new AppError(
      'Selected printer does not have a configured printer_name',
      409
    );
  }

  const conn = await pool.getConnection();

  let responseData;

  try {
    await conn.beginTransaction();

    // ----------------------------------------------------------
    // 1. Load and lock selected CUSTOMER_QR template
    // ----------------------------------------------------------

    const [templateRows] = await conn.query(
      `SELECT
         id,
         name,
         template_type,
         dpi,
         width,
         height,
         pitch_x,
         pitch_y,
         elements,
         is_active
       FROM label_templates
       WHERE id = ?
         AND template_type = 'CUSTOMER_QR'
       FOR UPDATE`,
      [templateId]
    );

    if (!templateRows.length) {
      throw new AppError(
        'Selected customer QR label template not found',
        404
      );
    }

    const template = templateRows[0];

    if (!template.is_active) {
      throw new AppError(
        'Selected customer QR label template is inactive',
        409
      );
    }

    if (
      !template.width ||
      !template.height ||
      !template.pitch_x ||
      !template.pitch_y
    ) {
      throw new AppError(
        'Selected customer QR template has invalid dimensions or pitch configuration',
        400
      );
    }

    // MySQL JSON column may already be an object depending on driver config
    let templateElements = template.elements;

    if (typeof templateElements === 'string') {
      try {
        templateElements = JSON.parse(templateElements);
      } catch (error) {
        throw new AppError(
          'Selected customer QR template contains invalid elements JSON',
          400
        );
      }
    }

    if (!Array.isArray(templateElements)) {
      throw new AppError(
        'Selected customer QR template has invalid elements configuration',
        400
      );
    }

    template.elements = templateElements;

    // ----------------------------------------------------------
    // 2. Lock rule + get product information
    // ----------------------------------------------------------

    const [ruleRows] = await conn.query(
      `SELECT
         r.*,
         p.name AS product_name,
         p.part_code AS product_part_code,
         p.erp_no AS product_erp_no
       FROM customer_serial_rules r
       LEFT JOIN products p
         ON p.id = r.product_id
       WHERE r.id = ?
       FOR UPDATE`,
      [id]
    );

    if (!ruleRows.length) {
      throw new AppError(
        'Customer serial rule not found',
        404
      );
    }

    const rule = ruleRows[0];

    if (!rule.is_active) {
      throw new AppError(
        'This rule is inactive',
        409
      );
    }

    if (!rule.product_name) {
      throw new AppError(
        'Product configured for this rule was not found',
        404
      );
    }

    // ----------------------------------------------------------
    // 3. Current ISO year/week
    // ----------------------------------------------------------

    const { yy, week } = getIsoYearWeek();

    const maxSerial = 10 ** rule.serial_width - 1;

    // ----------------------------------------------------------
    // 4. Get/create current bucket
    // ----------------------------------------------------------

    let [bucketRows] = await conn.query(
      `SELECT *
       FROM customer_qr_buckets
       WHERE rule_id = ?
         AND year = ?
         AND week = ?
       FOR UPDATE`,
      [id, yy, week]
    );

    let bucket = bucketRows[0];

    if (!bucket) {
      const [insertResult] = await conn.query(
        `INSERT INTO customer_qr_buckets
         (
           rule_id,
           customer_name,
           product_id,
           part_code,
           year,
           week,
           start_serial,
           end_serial,
           next_serial,
           generated_qty,
           printer_id,
           status,
           created_by
         )
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, 1, 0, ?, 'ACTIVE', ?)`,
        [
          id,
          rule.customer_name,
          rule.product_id,
          rule.part_code,
          yy,
          week,
          maxSerial,
          printerId,
          req.user?.id ?? null,
        ]
      );

      [bucketRows] = await conn.query(
        `SELECT *
         FROM customer_qr_buckets
         WHERE id = ?
         FOR UPDATE`,
        [insertResult.insertId]
      );

      bucket = bucketRows[0];
    } else {
      // Latest printer selected for this bucket
      await conn.query(
        `UPDATE customer_qr_buckets
         SET printer_id = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [printerId, bucket.id]
      );

      bucket.printer_id = printerId;
    }

    // ----------------------------------------------------------
    // 5. Validate bucket
    // ----------------------------------------------------------

    if (bucket.status !== 'ACTIVE') {
      throw new AppError(
        `This week's bucket is ${bucket.status.toLowerCase()} and cannot generate more codes`,
        409
      );
    }

    // ----------------------------------------------------------
    // 6. Calculate serial range
    // ----------------------------------------------------------

    const startSerial = bucket.next_serial;
    const endSerial = startSerial + quantity - 1;

    if (endSerial > bucket.end_serial) {
      const remaining = Math.max(
        bucket.end_serial - startSerial + 1,
        0
      );

      throw new AppError(
        `Requested quantity exceeds the available range for this week. Only ${remaining} serials remain.`,
        409
      );
    }

    // ----------------------------------------------------------
    // 7. Reserve serial range
    // ----------------------------------------------------------

    const newStatus =
      endSerial >= bucket.end_serial
        ? 'COMPLETED'
        : 'ACTIVE';

    await conn.query(
      `UPDATE customer_qr_buckets
       SET next_serial = ?,
           generated_qty = generated_qty + ?,
           status = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [
        endSerial + 1,
        quantity,
        newStatus,
        bucket.id,
      ]
    );

    // ----------------------------------------------------------
    // 8. Keep legacy rule counters synchronized
    // ----------------------------------------------------------

    await conn.query(
      `UPDATE customer_serial_rules
       SET current_year = ?,
           current_week = ?,
           next_serial = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [
        yy,
        week,
        endSerial + 1,
        id,
      ]
    );

    // ----------------------------------------------------------
    // 9. Create QR inventory records
    // ----------------------------------------------------------

    const qrRows = [];

    for (
      let serialNo = startSerial;
      serialNo <= endSerial;
      serialNo++
    ) {
      const qrCode = buildSerialString(
        rule.part_code,
        serialNo,
        yy,
        week,
        rule.serial_width
      );

      qrRows.push([
        bucket.id,
        serialNo,
        qrCode,
        'GENERATED',
      ]);
    }

    for (const batch of chunk(qrRows, CHUNK_SIZE)) {
      await conn.query(
        `INSERT INTO customer_qr_codes
         (
           bucket_id,
           serial_no,
           qr_code,
           status
         )
         VALUES ?`,
        [batch]
      );
    }

    // ----------------------------------------------------------
    // 10. Get exact generated records
    // ----------------------------------------------------------

    const [insertedRows] = await conn.query(
      `SELECT
         id,
         serial_no,
         qr_code
       FROM customer_qr_codes
       WHERE bucket_id = ?
         AND serial_no BETWEEN ? AND ?
       ORDER BY serial_no ASC`,
      [
        bucket.id,
        startSerial,
        endSerial,
      ]
    );

    if (insertedRows.length !== quantity) {
      throw new AppError(
        'Generated QR record count does not match requested quantity',
        500
      );
    }

    // ----------------------------------------------------------
    // 11. Build complete physical label data
    // ----------------------------------------------------------

    const labels = insertedRows.map((row) => ({
      qr_code: row.qr_code,
      customer_serial: row.qr_code,

      product_name: rule.product_name,
      part_code: rule.product_part_code,
      erp_no: rule.product_erp_no,

      customer_prefix: rule.part_code,
    }));

    // ----------------------------------------------------------
    // 12. Build ZPL using selected template
    // ----------------------------------------------------------

    const zpl = buildCustomerQrBatchZpl(
      template,
      labels
    );

    if (!zpl) {
      throw new AppError(
        'Failed to generate ZPL from selected customer QR template',
        500
      );
    }

    // ----------------------------------------------------------
    // 13. Commit database transaction
    // ----------------------------------------------------------

    await conn.commit();

    // ----------------------------------------------------------
    // 14. Response
    // ----------------------------------------------------------

    responseData = {
      bucket_id: bucket.id,

      printer_id: printer.id,
      printer_name: printer.printer_name,

      template_id: template.id,
      template_name: template.name,

      from: buildSerialString(
        rule.part_code,
        startSerial,
        yy,
        week,
        rule.serial_width
      ),

      to: buildSerialString(
        rule.part_code,
        endSerial,
        yy,
        week,
        rule.serial_width
      ),

      quantity,

      qrCodes: insertedRows,

      zpl,
    };

  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackError) {
      console.error(
        'Customer QR rollback failed:',
        rollbackError.message
      );
    }

    throw err;

  } finally {
    conn.release();
  }

  res.json({
    data: responseData,
  });
});


// ---------------------------------------------------------------------
// POST /qr-codes/mark-printed  { ids }
// Step 9 — called by the frontend after QZ Tray confirms the batch was
// sent to the printer.
// ---------------------------------------------------------------------
export const markCustomerQrCodesPrinted = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    throw new AppError('ids must be a non-empty array', 400);
  }

  const [result] = await pool.query(
    `UPDATE customer_qr_codes SET status = 'PRINTED', printed_at = NOW() WHERE id IN (?)`,
    [ids]
  );

  res.json({ data: { updated: result.affectedRows } });
});

// ---------------------------------------------------------------------
// GET /qr-codes/pending
// Groups un-printed (GENERATED) QR codes by bucket, so a batch that
// failed to print (printer offline, job cancelled, etc.) can be found
// and reprinted without burning new serials.
// ---------------------------------------------------------------------
export const getPendingQrBatches = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT
       b.id AS bucket_id,
       b.customer_name,
       b.part_code,
       b.year,
       b.week,
       b.printer_id,
       pr.name AS printer_name,
       COUNT(c.id) AS pending_count,
       MIN(c.created_at) AS first_generated_at
     FROM customer_qr_codes c
     JOIN customer_qr_buckets b ON b.id = c.bucket_id
     LEFT JOIN printers pr ON pr.id = b.printer_id
     WHERE c.status = 'GENERATED'
     GROUP BY b.id
     ORDER BY first_generated_at ASC`
  );
  res.json({ data: rows });
});

// ---------------------------------------------------------------------
// POST /qr-codes/reprint
// { bucket_id, printer_id, template_id }
//
// Rebuilds ZPL for every still-GENERATED code in a bucket.
// Does NOT create/reserve new serials.
// Frontend prints returned ZPL, then calls mark-printed.
// ---------------------------------------------------------------------
export const reprintPendingQrCodes = asyncHandler(async (req, res) => {
  const { bucket_id, printer_id, template_id } = req.body;

  if (!bucket_id) {
    throw new AppError('bucket_id is required', 400);
  }

  if (!template_id) {
    throw new AppError('template_id is required', 400);
  }

  // ------------------------------------------------------------
  // Get bucket + rule + product
  // ------------------------------------------------------------

  const [bucketRows] = await pool.query(
    `SELECT
       b.id AS bucket_id,
       b.printer_id,
       r.part_code AS customer_prefix,
       r.serial_width,
       p.name AS product_name,
       p.part_code AS product_part_code,
       p.erp_no AS product_erp_no
     FROM customer_qr_buckets b
     JOIN customer_serial_rules r
       ON r.id = b.rule_id
     LEFT JOIN products p
       ON p.id = b.product_id
     WHERE b.id = ?`,
    [bucket_id]
  );

  if (!bucketRows.length) {
    throw new AppError(
      'Customer QR bucket not found',
      404
    );
  }

  const bucket = bucketRows[0];

  // ------------------------------------------------------------
  // Printer selection
  // ------------------------------------------------------------

  if (printer_id) {
    const [printerRows] = await pool.query(
      `SELECT
         id,
         name,
         printer_name,
         is_active
       FROM printers
       WHERE id = ?
         AND is_active = 1`,
      [printer_id]
    );

    if (!printerRows.length) {
      throw new AppError(
        'Selected printer not found or inactive',
        404
      );
    }

    const printer = printerRows[0];

    if (!printer.printer_name) {
      throw new AppError(
        'Selected printer is missing printer_name',
        400
      );
    }

    await pool.query(
      `UPDATE customer_qr_buckets
       SET printer_id = ?
       WHERE id = ?`,
      [printer_id, bucket_id]
    );

    bucket.printer_id = printer_id;
  }

  // ------------------------------------------------------------
  // Get selected CUSTOMER_QR template
  // ------------------------------------------------------------

  const [templateRows] = await pool.query(
    `SELECT
       id,
       name,
       template_type,
       dpi,
       width,
       height,
       pitch_x,
       pitch_y,
       elements,
       is_active
     FROM label_templates
     WHERE id = ?
       AND template_type = 'CUSTOMER_QR'
       AND is_active = 1`,
    [template_id]
  );

  if (!templateRows.length) {
    throw new AppError(
      'Customer QR label template not found or inactive',
      404
    );
  }

  const template = templateRows[0];

  // ------------------------------------------------------------
  // Validate template dimensions
  // ------------------------------------------------------------

  if (
    !Number.isFinite(Number(template.width)) ||
    Number(template.width) <= 0
  ) {
    throw new AppError(
      'Selected template has invalid width',
      400
    );
  }

  if (
    !Number.isFinite(Number(template.height)) ||
    Number(template.height) <= 0
  ) {
    throw new AppError(
      'Selected template has invalid height',
      400
    );
  }

  if (
    !Number.isFinite(Number(template.pitch_x)) ||
    Number(template.pitch_x) <= 0
  ) {
    throw new AppError(
      'Selected template has invalid pitch_x',
      400
    );
  }

  if (
    !Number.isFinite(Number(template.pitch_y)) ||
    Number(template.pitch_y) <= 0
  ) {
    throw new AppError(
      'Selected template has invalid pitch_y',
      400
    );
  }

  // ------------------------------------------------------------
  // Parse template elements
  // ------------------------------------------------------------

  try {
    template.elements =
      typeof template.elements === 'string'
        ? JSON.parse(template.elements)
        : template.elements;

    if (!Array.isArray(template.elements)) {
      throw new Error('elements must be an array');
    }
  } catch (error) {
    throw new AppError(
      'Selected label template has invalid elements configuration',
      400
    );
  }

  // ------------------------------------------------------------
  // Pending QR codes
  // ------------------------------------------------------------

  const [rows] = await pool.query(
    `SELECT
       id,
       serial_no,
       qr_code
     FROM customer_qr_codes
     WHERE bucket_id = ?
       AND status = 'GENERATED'
     ORDER BY serial_no ASC`,
    [bucket_id]
  );

  if (!rows.length) {
    throw new AppError(
      'No pending QR codes for this bucket',
      404
    );
  }

  // ------------------------------------------------------------
  // Build complete label data
  // ------------------------------------------------------------

  const labels = rows.map((row) => ({
    qr_code: row.qr_code,
    customer_serial: row.qr_code,

    product_name: bucket.product_name || '',
    part_code: bucket.product_part_code || '',
    erp_no: bucket.product_erp_no || '',
    customer_prefix: bucket.customer_prefix || '',
  }));

  // ------------------------------------------------------------
  // Build template-based ZPL
  // ------------------------------------------------------------

  const zpl = buildCustomerQrBatchZpl(
    template,
    labels
  );

  if (!zpl) {
    throw new AppError(
      'Failed to generate ZPL from selected template',
      500
    );
  }

  // ------------------------------------------------------------
  // Return data — nothing is marked printed here
  // ------------------------------------------------------------

  return res.json({
    data: {
      bucket_id,
      printer_id: bucket.printer_id,
      template_id: template.id,
      template_name: template.name,
      printer_name: printer_id
        ? undefined
        : undefined,
      qrCodes: rows,
      zpl,
    },
  });
});