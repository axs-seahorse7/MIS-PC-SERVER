  // controller/productPrintJob.controller.js

  import pool from "../DB/config/mysql.config.js";
  import { AppError, asyncHandler } from "../utils/AppError.js";
  import { buildProductQrBatchZpl } from "../utils/zplBuilder.productQr.js";

  // ---------------------------------------------------------------------
  // POST /product-print-jobs
  //
  // Creates a product QR print job for existing production order items.
  // Does NOT generate or modify serial numbers.
  //
  // Body:
  // {
  //   production_order_id,
  //   printer_id,
  //   template_id,
  //   item_ids: []
  // }
  // ---------------------------------------------------------------------
  export const createProductPrintJob = asyncHandler(async (req, res) => {
    const {
      production_order_id,
      printer_id,
      template_id,
      item_ids,
    } = req.body;

    // ------------------------------------------------------------
    // Basic validation
    // ------------------------------------------------------------

    if (!production_order_id) {
      throw new AppError(
        "production_order_id is required",
        400
      );
    }

    if (!printer_id) {
      throw new AppError(
        "printer_id is required",
        400
      );
    }

    if (!template_id) {
      throw new AppError(
        "template_id is required",
        400
      );
    }

    if (!Array.isArray(item_ids) || !item_ids.length) {
      throw new AppError(
        "item_ids must contain at least one production order item",
        400
      );
    }

    // ------------------------------------------------------------
    // Prevent unnecessarily large print requests
    // ------------------------------------------------------------

    if (item_ids.length > 500) {
      throw new AppError(
        "Maximum 500 items can be printed in one job",
        400
      );
    }

    const session = await pool.getConnection();

    try {
      await session.beginTransaction();

      // ----------------------------------------------------------
      // Production order
      // ----------------------------------------------------------

      const [orderRows] = await session.query(
        `SELECT
          id,
          order_no,
          product_id,
          target_qty,
          status
        FROM production_orders
        WHERE id = ?
        FOR UPDATE`,
        [production_order_id]
      );

      if (!orderRows.length) {
        throw new AppError(
          "Production order not found",
          404
        );
      }

      const order = orderRows[0];

      // ----------------------------------------------------------
      // Product
      // ----------------------------------------------------------

      const [productRows] = await session.query(
        `SELECT
          id,
          name,
          part_code,
          erp_no,
          is_active
        FROM products
        WHERE id = ?`,
        [order.product_id]
      );

      if (!productRows.length) {
        throw new AppError(
          "Product for production order not found",
          404
        );
      }

      const product = productRows[0];

      // ----------------------------------------------------------
      // Printer
      // ----------------------------------------------------------

      const [printerRows] = await session.query(
        `SELECT
          id,
          name,
          printer_type,
          printer_name,
          is_active
        FROM printers
        WHERE id = ?
          AND is_active = 1`,
        [printer_id]
      );

      if (!printerRows.length) {
        throw new AppError(
          "Selected printer not found or inactive",
          404
        );
      }

      const printer = printerRows[0];

      if (!printer.printer_name) {
        throw new AppError(
          "Selected printer is missing printer_name",
          400
        );
      }

      // ----------------------------------------------------------
      // Product QR template
      // ----------------------------------------------------------

      const [templateRows] = await session.query(
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
          AND template_type = 'PRODUCT_QR'
          AND is_active = 1`,
        [template_id]
      );

      if (!templateRows.length) {
        throw new AppError(
          "Product QR template not found or inactive",
          404
        );
      }

      const template = templateRows[0];

      // ----------------------------------------------------------
      // Validate template dimensions
      // ----------------------------------------------------------

      if (
        !Number.isFinite(Number(template.width)) ||
        Number(template.width) <= 0
      ) {
        throw new AppError(
          "Selected template has invalid width",
          400
        );
      }

      if (
        !Number.isFinite(Number(template.height)) ||
        Number(template.height) <= 0
      ) {
        throw new AppError(
          "Selected template has invalid height",
          400
        );
      }

      if (
        !Number.isFinite(Number(template.pitch_x)) ||
        Number(template.pitch_x) <= 0
      ) {
        throw new AppError(
          "Selected template has invalid pitch_x",
          400
        );
      }

      if (
        !Number.isFinite(Number(template.pitch_y)) ||
        Number(template.pitch_y) <= 0
      ) {
        throw new AppError(
          "Selected template has invalid pitch_y",
          400
        );
      }

      // ----------------------------------------------------------
      // Parse template elements
      // ----------------------------------------------------------

      try {
        template.elements =
          typeof template.elements === "string"
            ? JSON.parse(template.elements)
            : template.elements;

        if (!Array.isArray(template.elements)) {
          throw new Error(
            "Template elements must be an array"
          );
        }
      } catch (error) {
        throw new AppError(
          "Selected template has invalid elements configuration",
          400
        );
      }

      // ----------------------------------------------------------
      // Production order items
      //
      // Important:
      // These are the existing serial numbers.
      // Nothing is generated here.
      // ----------------------------------------------------------

      const placeholders = item_ids
        .map(() => "?")
        .join(",");

      const [itemRows] = await session.query(
        `SELECT
          id,
          production_order_id,
          serial_no,
          customer_qr_code,
          sequence_no,
          status
        FROM production_order_items
        WHERE production_order_id = ?
          AND id IN (${placeholders})
        ORDER BY sequence_no ASC
        FOR UPDATE`,
        [
          production_order_id,
          ...item_ids,
        ]
      );

      // ----------------------------------------------------------
      // Make sure every requested item was found
      // ----------------------------------------------------------

      if (itemRows.length !== item_ids.length) {
        const foundIds = new Set(
          itemRows.map((item) => Number(item.id))
        );

        const missingIds = item_ids.filter(
          (id) => !foundIds.has(Number(id))
        );

        throw new AppError(
          `Some production order items were not found: ${missingIds.join(", ")}`,
          400
        );
      }

      // ----------------------------------------------------------
      // Only ACTIVE items can be printed
      // ----------------------------------------------------------

      const rejectedItems = itemRows.filter(
        (item) => item.status !== "ACTIVE"
      );

      if (rejectedItems.length) {
        throw new AppError(
          `Cannot print rejected/inactive production items: ${rejectedItems
            .map((item) => item.serial_no)
            .join(", ")}`,
          400
        );
      }

      // ----------------------------------------------------------
      // Build label data
      // ----------------------------------------------------------

      const labels = itemRows.map((item) => ({
        serial_no: item.serial_no,

        product_name: product.name || "",
        part_code: product.part_code || "",
        erp_no: product.erp_no || "",

        order_no: order.order_no || "",
        sequence_no: item.sequence_no,

        production_order_id:
          order.id,

        production_order_item_id:
          item.id,

        customer_qr_code:
          item.customer_qr_code || "",
      }));

      // ----------------------------------------------------------
      // Build ZPL
      // ----------------------------------------------------------

      const zpl = buildProductQrBatchZpl(
        template,
        labels
      );

      if (!zpl) {
        throw new AppError(
          "Failed to generate ZPL from selected template",
          500
        );
      }

      // ----------------------------------------------------------
      // Create print job
      // ----------------------------------------------------------

      const createdBy =
        req.user?.id ?? null;

      const [jobResult] = await session.query(
        `INSERT INTO product_print_jobs (
          production_order_id,
          printer_id,
          template_id,
          quantity,
          status,
          created_by
        )
        VALUES (?, ?, ?, ?, 'CREATED', ?)`,
        [
          production_order_id,
          printer_id,
          template_id,
          itemRows.length,
          createdBy,
        ]
      );

      const printJobId = jobResult.insertId;

      // ----------------------------------------------------------
      // Create print job items
      // ----------------------------------------------------------

      const jobItemValues = itemRows.map((item) => [
        printJobId,
        item.id,
        "PENDING",
      ]);

      await session.query(
        `INSERT INTO product_print_job_items (
          print_job_id,
          production_order_item_id,
          status
        )
        VALUES ?`,
        [jobItemValues]
      );

      // ----------------------------------------------------------
      // Commit
      // ----------------------------------------------------------

      await session.commit();

      // ----------------------------------------------------------
      // Response
      // ----------------------------------------------------------

      return res.status(201).json({
        data: {
          job: {
            id: printJobId,
            production_order_id,
            printer_id,
            printer_name: printer.printer_name,
            template_id,
            template_name: template.name,
            quantity: itemRows.length,
            status: "CREATED",
          },

          items: itemRows.map((item) => ({
            id: item.id,
            serial_no: item.serial_no,
            sequence_no: item.sequence_no,
            status: "PENDING",
          })),

          zpl,
        },
      });

    } catch (error) {
      await session.rollback();
      throw error;
    } finally {
      session.release();
    }
  });