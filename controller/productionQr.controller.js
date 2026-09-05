import pool from "../DB/config/mysql.config.js";
import { AppError, asyncHandler } from "../utils/AppError.js";
import { buildProductQrBatchZpl } from "../utils/zplBuilder.productQr.js";

const CHUNK_SIZE = 2000;
const MAX_BATCH_QUANTITY = 5000;

// ------------------------------------------------------------
// ISO year / week
// ------------------------------------------------------------

const getIsoYearWeek = (date = new Date()) => {
  const d = new Date(
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    )
  );

  const dayNum = d.getUTCDay() || 7;

  d.setUTCDate(
    d.getUTCDate() + 4 - dayNum
  );

  const yearStart = new Date(
    Date.UTC(d.getUTCFullYear(), 0, 1)
  );

  const week = Math.ceil(
    (((d - yearStart) / 86400000) + 1) / 7
  );

  const year = d.getUTCFullYear();

  return {
    year,
    week,
    yy: Number(String(year).slice(-2)),
  };
};

// ------------------------------------------------------------
// Date segment
// ------------------------------------------------------------

const getDatePart = (
  part,
  date = new Date()
) => {
  const dd = String(
    date.getDate()
  ).padStart(2, "0");

  const mm = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const yyyy = String(
    date.getFullYear()
  );

  const yy = yyyy.slice(-2);

  switch (part) {
    case "YYYY":
      return yyyy;

    case "YY":
      return yy;

    case "MM":
      return mm;

    case "DD":
      return dd;

    case "WW":
      return String(
        getIsoYearWeek(date).week
      ).padStart(2, "0");

    default:
      return "";
  }
};

// ------------------------------------------------------------
// Product field
// ------------------------------------------------------------

const getProductFieldValue = (
  field,
  product
) => {
  switch (field) {
    case "name":
      return product.name || "";

    case "part_code":
      return product.part_code || "";

    case "erp_no":
      return product.erp_no || "";

    default:
      return "";
  }
};

// ------------------------------------------------------------
// Build QR data from serial rule
// ------------------------------------------------------------

const buildQrData = ({
  rule,
  product,
  serial,
  date,
}) => {
  return rule
    .map((segment) => {
      switch (segment.type) {
        case "STATIC":
          return String(
            segment.value || ""
          );

        case "PRODUCT_FIELD":
          return getProductFieldValue(
            segment.field,
            product
          );

        case "DATE":
          return (segment.parts || [])
            .map((part) =>
              getDatePart(
                part,
                date
              )
            )
            .join("");

        case "SERIAL":
          return String(serial).padStart(
            Number(segment.width),
            "0"
          );

        default:
          return "";
      }
    })
    .join("");
};

// ------------------------------------------------------------
// Parse rule
// ------------------------------------------------------------

const parseRule = (value) => {
  try {
    const rule =
      typeof value === "string"
        ? JSON.parse(value)
        : value;

    if (!Array.isArray(rule)) {
      throw new Error(
        "Rule must be an array"
      );
    }

    return rule;
  } catch {
    throw new AppError(
      "Production serial rule has invalid configuration",
      400
    );
  }
};

// ------------------------------------------------------------
// Get SERIAL segment
// ------------------------------------------------------------

const getSerialSegment = (rule) => {
  const segment = rule.find(
    (item) =>
      item?.type === "SERIAL"
  );

  if (!segment) {
    throw new AppError(
      "Production serial rule does not contain a SERIAL segment",
      400
    );
  }

  const width = Number(
    segment.width
  );

  if (
    !Number.isInteger(width) ||
    width < 1 ||
    width > 5
  ) {
    throw new AppError(
      "Production serial rule has invalid SERIAL width",
      400
    );
  }

  return {
    width,
  };
};

// ------------------------------------------------------------
// GET /:id/generation-preview
//
// :id = production_serial_rules.id
// ------------------------------------------------------------

export const getProductionQrGenerationPreview = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [rows] = await pool.query(
    `
    SELECT
      psr.id,
      psr.product_id,
      psr.rule,
      psr.current_year,
      psr.current_week,
      psr.next_serial,
      psr.is_active,
      p.name AS product_name,
      p.part_code,
      p.erp_no
    FROM production_serial_rules psr
    LEFT JOIN products p ON p.id = psr.product_id
    WHERE psr.id = ?
    LIMIT 1
    `,
    [id]
  );

  if (!rows.length) {
    throw new AppError("Production serial rule not found", 404);
  }

  const ruleRecord = rows[0];

  if (!ruleRecord.is_active) {
    throw new AppError("This production serial rule is inactive", 409);
  }

  if (!ruleRecord.product_name) {
    throw new AppError("Product configured for this rule was not found", 404);
  }

  const rule = parseRule(ruleRecord.rule);
  const { width } = getSerialSegment(rule);
  const { year, week } = getIsoYearWeek();

  let availableFrom = Number(ruleRecord.next_serial) || 1;

  if (
    Number(ruleRecord.current_year) !== year ||
    Number(ruleRecord.current_week) !== week
  ) {
    availableFrom = 1;
  }

  const availableTo = 10 ** width - 1;
  const availableCount = Math.max(availableTo - availableFrom + 1, 0);

  const product = {
    id: ruleRecord.product_id,
    name: ruleRecord.product_name,
    part_code: ruleRecord.part_code,
    erp_no: ruleRecord.erp_no,
  };

  const generationDate = new Date();

  const previewSamples = [];

  for (let i = 0; i < Math.min(3, availableCount); i++) {
    const serial = availableFrom + i;

    const qrData = buildQrData({
      rule,
      product,
      serial,
      date: generationDate,
    });

    previewSamples.push({
      serial_no: qrData,
      qr_data: qrData,
    });
  }

  res.json({
    data: {
      rule_id: ruleRecord.id,
      product_id: ruleRecord.product_id,

      product_name: ruleRecord.product_name,
      part_code: ruleRecord.part_code,
      erp_no: ruleRecord.erp_no,

      rule,
      serial_width: width,

      year,
      week,

      current_bucket: `${year}-W${String(week).padStart(2, "0")}`,

      available_from: availableFrom,
      available_to: availableTo,
      available_count: availableCount,
      next_serial: availableFrom,

      preview_samples: previewSamples,
    },
  });
});

// ------------------------------------------------------------
// POST /:id/generate-batch
//
// Body:
// {
//   quantity,
//   printer_id,
//   template_id
// }
// ------------------------------------------------------------

    export const generateProductionQrCodes = asyncHandler(async (req, res) => {
        const { id } = req.params;

        const quantity =
        Number(req.body.quantity);

        const printerId =
        req.body.printer_id;

        const templateId =
        req.body.template_id;

        if (
        !Number.isInteger(quantity) ||
        quantity < 1
        ) {
        throw new AppError(
            "quantity must be a positive integer",
            400
        );
        }

        if (
        quantity > MAX_BATCH_QUANTITY
        ) {
        throw new AppError(
            `Maximum ${MAX_BATCH_QUANTITY} product QR codes can be generated at once`,
            400
        );
        }

        if (!printerId) {
        throw new AppError(
            "printer_id is required",
            400
        );
        }

        if (!templateId) {
        throw new AppError(
            "template_id is required",
            400
        );
        }

        const conn =
        await pool.getConnection();

        try {
        await conn.beginTransaction();

        // ------------------------------------------------------
        // 1. Lock serial rule + product
        // ------------------------------------------------------

        const [ruleRows] =
            await conn.query(
            `
            SELECT
                psr.*,

                p.name AS product_name,
                p.part_code,
                p.erp_no,
                p.is_active AS product_active

            FROM production_serial_rules psr

            JOIN products p
                ON p.id = psr.product_id

            WHERE psr.id = ?

            FOR UPDATE
            `,
            [id]
            );

        if (!ruleRows.length) {
            throw new AppError(
            "Production serial rule not found",
            404
            );
        }

        const ruleRecord =
            ruleRows[0];

        if (!ruleRecord.is_active) {
            throw new AppError(
            "This production serial rule is inactive",
            409
            );
        }

        if (!ruleRecord.product_active) {
            throw new AppError(
            "Product configured for this rule is inactive",
            409
            );
        }

        const product = {
            id: ruleRecord.product_id,
            name: ruleRecord.product_name,
            part_code: ruleRecord.part_code,
            erp_no: ruleRecord.erp_no,
        };

        const rule = parseRule(
            ruleRecord.rule
        );

        const { width } =
            getSerialSegment(rule);

        // ------------------------------------------------------
        // 2. Current ISO year/week
        // ------------------------------------------------------

        const {
            year,
            week,
        } = getIsoYearWeek();

        let nextSerial =
            Number(
            ruleRecord.next_serial
            ) || 1;

        // ------------------------------------------------------
        // 3. Automatic weekly reset
        // ------------------------------------------------------

        if (
            Number(
            ruleRecord.current_year
            ) !== year ||
            Number(
            ruleRecord.current_week
            ) !== week
        ) {
            nextSerial = 1;

            await conn.query(
            `
            UPDATE production_serial_rules
            SET
                current_year = ?,
                current_week = ?,
                next_serial = 1,
                updated_at = NOW()
            WHERE id = ?
            `,
            [
                year,
                week,
                id,
            ]
            );
        }

        // ------------------------------------------------------
        // 4. Weekly range validation
        // ------------------------------------------------------

        const maxSerial =
            10 ** width - 1;

        const startSerial =
            nextSerial;

        const endSerial =
            startSerial +
            quantity -
            1;

        if (
            endSerial >
            maxSerial
        ) {
            const remaining =
            Math.max(
                maxSerial -
                startSerial +
                1,
                0
            );

            throw new AppError(
            `Requested quantity exceeds the available range for this week. Only ${remaining} serials remain.`,
            409
            );
        }

        // ------------------------------------------------------
        // 5. Prevent collision with previously generated
        //    physical QR identities.
        // ------------------------------------------------------

        const generationDate = new Date();
        const previewQrData = [];

        for (let serial = startSerial; serial <= endSerial; serial++) {
        const qrData = buildQrData({
            rule,
            product,
            serial,
            date: generationDate,
        });

        if (!qrData) {
            throw new AppError(
            `Failed to generate QR data for serial ${String(serial).padStart(width, "0")}`,
            500
            );
        }

        previewQrData.push(qrData);
        }

        const [collisionRows] = await conn.query(
        `
        SELECT serial_no
        FROM production_qr_codes
        WHERE product_id = ?
            AND serial_no IN (?)
        LIMIT 1
        `,
        [product.id, previewQrData]
        );

        if (collisionRows.length) {
        throw new AppError(
            `QR identity already exists: ${collisionRows[0].serial_no}`,
            409
        );
        }

        // ------------------------------------------------------
        // 6. Validate printer
        // ------------------------------------------------------

        const [printerRows] =
            await conn.query(
            `
            SELECT
                id,
                name,
                printer_name,
                is_active

            FROM printers

            WHERE id = ?
                AND is_active = 1

            LIMIT 1
            `,
            [printerId]
            );

        if (!printerRows.length) {
            throw new AppError(
            "Selected printer not found or inactive",
            404
            );
        }

        const printer =
            printerRows[0];

        if (!printer.printer_name) {
            throw new AppError(
            "Selected printer is missing printer_name",
            400
            );
        }

        // ------------------------------------------------------
        // 7. Validate Product QR template
        // ------------------------------------------------------

        const [templateRows] =
            await conn.query(
            `
            SELECT
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
                AND template_type = 'PRODUCT_QR'
                AND is_active = 1

            LIMIT 1
            `,
            [templateId]
            );

        if (!templateRows.length) {
            throw new AppError(
            "Selected product QR template not found or inactive",
            404
            );
        }

        const template = templateRows[0];

        if (!Number.isFinite(Number(template.width)) ||Number(template.width) <= 0) {
            throw new AppError("Selected template has invalid width",400);
        }

        if (!Number.isFinite(Number(template.height)) ||Number(template.height) <= 0) {
            throw new AppError("Selected template has invalid height",400);
        }

        if (!Number.isFinite(Number(template.pitch_x)) ||Number(template.pitch_x) <= 0) {
            throw new AppError("Selected template has invalid pitch_x",400);
        }

        if (!Number.isFinite(Number(template.pitch_y)) ||Number(template.pitch_y) <= 0) {
            throw new AppError("Selected template has invalid pitch_y", 400);
        }

        try {
            template.elements = typeof template.elements === "string"? JSON.parse(template.elements) : template.elements;

            if (!Array.isArray(template.elements)
            ) {
            throw new Error("elements must be an array");
            }
        } catch {
            throw new AppError("Selected product QR template has invalid elements configuration", 400);
        }

        

        // ------------------------------------------------------
        // 8.1 Create bucket
        // ------------------------------------------------------

        const [bucketResult] =
            await conn.query(
            `
            INSERT INTO production_qr_buckets
            (
                product_id,
                current_year,
                current_week,
                start_serial,
                end_serial,
                generated_qty,
                printed_qty,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?, 0, 'GENERATED')
            `,
            [
                product.id,
                year,
                week,
                startSerial,
                endSerial,
                quantity,
            ]
            );

        const bucketId = bucketResult.insertId;

        // ------------------------------------------------------
        // 9. Generate QR inventory
        // ------------------------------------------------------

        // const generationDate = new Date();
        const qrRows = [];

        for (let i = 0; i < previewQrData.length; i++) {
        const qrData = previewQrData[i];

        qrRows.push([
            bucketId,
            product.id,
            qrData,
            qrData,
            "GENERATED",
        ]);
        }

        // ------------------------------------------------------
        // 10. Insert in chunks
        // ------------------------------------------------------

        for (let i = 0; i < qrRows.length; i += CHUNK_SIZE) {
        const batch = qrRows.slice(i, i + CHUNK_SIZE);

        await conn.query(
            `
            INSERT INTO production_qr_codes
            (
            bucket_id,
            product_id,
            serial_no,
            qr_data,
            status
            )
            VALUES ?
            `,
            [batch]
        );
        }

        // ------------------------------------------------------
        // 11. Advance rule counter
        // ------------------------------------------------------

        await conn.query(
            `
            UPDATE production_serial_rules
            SET
            current_year = ?,
            current_week = ?,
            next_serial = ?,
            updated_at = NOW()
            WHERE id = ?
            `,
            [year, week, endSerial + 1, id]
        );

        // ------------------------------------------------------
        // 12. Get generated records
        // ------------------------------------------------------

        const [generatedRows] =
            await conn.query(
            `
            SELECT
                id,
                serial_no,
                qr_data,
                status

            FROM production_qr_codes
            WHERE bucket_id = ?
            ORDER BY id ASC
            `,
            [bucketId]
            );

        if (generatedRows.length !== quantity) {
            throw new AppError("Generated QR record count does not match requested quantity", 500);
        }

        // ------------------------------------------------------
        // 13. Build Product QR label data
        // ------------------------------------------------------

        const labels =
            generatedRows.map(
            (row) => ({
                serial_no:row.serial_no,
                qr_data:row.qr_data,
                product_name:product.name || "",
                part_code:product.part_code || "",
                erp_no:product.erp_no || "",
            })
            );

        // ------------------------------------------------------
        // 14. Build ZPL
        // ------------------------------------------------------

        const zpl = buildProductQrBatchZpl(template, labels);

        if (!zpl) {
            throw new AppError("Failed to generate Product QR ZPL", 500);
        }

        // ------------------------------------------------------
        // 15. Commit
        // ------------------------------------------------------

        await conn.commit();

        // ------------------------------------------------------
        // 16. Response
        // ------------------------------------------------------

        return res.status(201).json({
            data: {
                bucket_id: bucketId,
                product_id: product.id,
                product_name: product.name,

                printer_id: printer.id,
                printer_name: printer.printer_name,

                template_id: template.id,
                template_name: template.name,

                year,
                week,

                from: startSerial,
                to: endSerial,

                quantity,

                qrCodes: generatedRows,

                zpl,
            },
        });

        } catch (error) {
        try {
            await conn.rollback();
        } catch (rollbackError) {
            console.error(
            "Production QR rollback failed:",
            rollbackError.message
            );
        }

        throw error;
        } finally {
        conn.release();
        }
    });

// ------------------------------------------------------------
// POST /qr-codes/mark-printed
//
// Body:
// {
//   ids: [1, 2, 3]
// }
// ------------------------------------------------------------

export const markProductionQrCodesPrinted = asyncHandler(async (req, res) => {
    const { ids } =
      req.body;

    if (
      !Array.isArray(ids) ||
      !ids.length
    ) {
      throw new AppError(
        "ids must be a non-empty array",
        400
      );
    }

    const uniqueIds = [
      ...new Set(
        ids.map(Number)
      ),
    ].filter(
      Number.isInteger
    );

    if (!uniqueIds.length) {
      throw new AppError(
        "ids must contain valid QR code IDs",
        400
      );
    }

    const conn =
      await pool.getConnection();

    try {
      await conn.beginTransaction();

      const placeholders =
        uniqueIds
          .map(() => "?")
          .join(",");

      // ------------------------------------------------------
      // Lock requested QR records
      // ------------------------------------------------------

      const [rows] =
        await conn.query(
          `
          SELECT
            id,
            bucket_id,
            status

          FROM production_qr_codes

          WHERE id IN (${placeholders})

          FOR UPDATE
          `,
          uniqueIds
        );

      if (
        rows.length !==
        uniqueIds.length
      ) {
        throw new AppError(
          "Some QR code IDs were not found",
          404
        );
      }

      // ------------------------------------------------------
      // Mark only GENERATED records
      // ------------------------------------------------------

      const pendingRows =
        rows.filter(
          (row) =>
            row.status ===
            "GENERATED"
        );

      if (pendingRows.length) {
        const pendingIds =
          pendingRows.map(
            (row) => row.id
          );

        const pendingPlaceholders =
          pendingIds
            .map(() => "?")
            .join(",");

        await conn.query(
          `
          UPDATE production_qr_codes
          SET
            status = 'PRINTED',
            printed_at = NOW(),
            updated_at = NOW()
          WHERE id IN (${pendingPlaceholders})
          `,
          pendingIds
        );
      }

      // ------------------------------------------------------
      // Update affected buckets
      // ------------------------------------------------------

      const bucketIds = [
        ...new Set(
          rows.map(
            (row) =>
              Number(row.bucket_id)
          )
        ),
      ];

      for (
        const bucketId of bucketIds
      ) {
        const [counts] =
          await conn.query(
            `
            SELECT
              COUNT(*) AS total_count,
              SUM(
                status = 'PRINTED'
              ) AS printed_count,
              SUM(
                status = 'GENERATED'
              ) AS pending_count

            FROM production_qr_codes

            WHERE bucket_id = ?
            `,
            [bucketId]
          );

        const count =
          counts[0];

        let status =
          "PRINTING";

        if (
          Number(
            count.pending_count
          ) === 0
        ) {
          status =
            "COMPLETED";
        }

        await conn.query(
          `
          UPDATE production_qr_buckets
          SET
            printed_qty = ?,
            status = ?,
            updated_at = NOW()
          WHERE id = ?
          `,
          [
            Number(
              count.printed_count
            ) || 0,
            status,
            bucketId,
          ]
        );
      }

      await conn.commit();

      res.json({
        data: {
          updated:
            pendingRows.length,
        },
      });

    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  });

// ------------------------------------------------------------
// GET /qr-codes/pending
//
// Returns buckets containing unprinted QR codes.
// ------------------------------------------------------------

export const getPendingProductionQrBatches = asyncHandler(async (req, res) => {
    const [rows] =
      await pool.query(
        `
        SELECT
          b.id AS bucket_id,

          b.product_id,

          p.name AS product_name,
          p.part_code,
          p.erp_no,

          b.current_year,
          b.current_week,

          b.start_serial,
          b.end_serial,

          b.generated_qty,
          b.printed_qty,

          COUNT(
            c.id
          ) AS pending_count,

          MIN(
            c.created_at
          ) AS first_generated_at,

          b.status

        FROM production_qr_codes c

        JOIN production_qr_buckets b
          ON b.id = c.bucket_id

        LEFT JOIN products p
          ON p.id = b.product_id

        WHERE c.status = 'GENERATED'

        GROUP BY
          b.id,
          b.product_id,
          p.name,
          p.part_code,
          p.erp_no,
          b.current_year,
          b.current_week,
          b.start_serial,
          b.end_serial,
          b.generated_qty,
          b.printed_qty,
          b.status

        ORDER BY
          first_generated_at ASC
        `
      );

    res.json({
      data: rows,
    });
  });

// ------------------------------------------------------------
// POST /qr-codes/reprint
//
// Body:
// {
//   bucket_id,
//   printer_id,
//   template_id
// }
//
// Only still-GENERATED codes are rebuilt.
// No new serials are generated.
// ------------------------------------------------------------

export const reprintProductionQrCodes = asyncHandler(async (req, res) => {
    const {
      bucket_id,
      printer_id,
      template_id,
    } = req.body;

    if (!bucket_id) {
      throw new AppError("bucket_id is required", 400);
    }

    if (!printer_id) {
      throw new AppError("printer_id is required", 400);
    }

    if (!template_id) {
      throw new AppError("template_id is required", 400);
    }

    // --------------------------------------------------------
    // Bucket + product
    // --------------------------------------------------------

    const [bucketRows] = await pool.query(
      `
      SELECT
        b.id AS bucket_id,
        b.product_id,

        p.name AS product_name,
        p.part_code,
        p.erp_no

      FROM production_qr_buckets b
      JOIN products p ON p.id = b.product_id
      WHERE b.id = ?
      LIMIT 1
      `,
      [bucket_id]
    );

    if (!bucketRows.length) {
      throw new AppError("Production QR bucket not found", 404);
    }

    const bucket = bucketRows[0];

    // --------------------------------------------------------
    // Printer
    // --------------------------------------------------------

    const [printerRows] = await pool.query(
        `
        SELECT
          id,
          name,
          printer_name,
          is_active

        FROM printers

        WHERE id = ?
          AND is_active = 1

        LIMIT 1
        `,
        [printer_id]
      );

    if (!printerRows.length) {
      throw new AppError("Selected printer not found or inactive", 404);
    }

    const printer = printerRows[0];

    if (!printer.printer_name) {
      throw new AppError("Selected printer is missing printer_name", 400);
    }

    // --------------------------------------------------------
    // Template
    // --------------------------------------------------------

    const [templateRows] =
      await pool.query(
        `
        SELECT
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
          AND template_type = 'PRODUCT_QR'
          AND is_active = 1

        LIMIT 1
        `,
        [template_id]
      );

    if (!templateRows.length) {
      throw new AppError("Product QR label template not found or inactive", 404);
    }

    const template = templateRows[0];

    if (!Number.isFinite(Number(template.width)) || Number(template.width) <= 0) {
      throw new AppError("Selected template has invalid width", 400);
    }

    if (!Number.isFinite(Number(template.height)) || Number(template.height) <= 0) {
      throw new AppError("Selected template has invalid height", 400    );
    }

    if (!Number.isFinite(Number(template.pitch_x)) || Number(template.pitch_x) <= 0) {
      throw new AppError("Selected template has invalid pitch_x",400);
    }

    if (!Number.isFinite(Number(template.pitch_y)) || Number(template.pitch_y) <= 0) {
      throw new AppError("Selected template has invalid pitch_y",400);
    }

    try {
      template.elements = typeof template.elements === "string"? JSON.parse(template.elements): template.elements;

      if (!Array.isArray(template.elements)) {
        throw new Error();
      }
    } catch {
      throw new AppError("Selected product QR template has invalid elements configuration", 400);
    }

    // --------------------------------------------------------
    // Pending QR codes
    // --------------------------------------------------------

    const [qrRows] =await pool.query(
        `
        SELECT
          id,
          serial_no,
          qr_data

        FROM production_qr_codes

        WHERE bucket_id = ?
          AND status = 'GENERATED'

        ORDER BY id ASC
        `,
        [bucket_id]
      );

    if (!qrRows.length) {
      throw new AppError("No pending QR codes for this bucket", 404);
    }

    // --------------------------------------------------------
    // Build labels
    // --------------------------------------------------------

    const labels = qrRows.map((row) => ({
          serial_no: row.serial_no,
          qr_data: row.qr_data,
          product_name: bucket.product_name || "",
          part_code: bucket.part_code || "",
          erp_no: bucket.erp_no || "",
        })
      );

    // --------------------------------------------------------
    // Build ZPL
    // --------------------------------------------------------

    const zpl = buildProductQrBatchZpl(template,labels);

    if (!zpl) {
      throw new AppError("Failed to generate Product QR ZPL", 500  );
    }

    res.json({
      data: {
        bucket_id,
        printer_id:printer.id,
        printer_name:printer.printer_name,
        template_id:template.id,
        template_name:template.name,
        qrCodes:qrRows,
        quantity:qrRows.length,
        zpl,
      },
    });
  });