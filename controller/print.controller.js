// PATCH /box-print-jobs/:id
import {pool} from "../DB/config/mysql.config.js";
import { asyncHandler, AppError } from "../utils/AppError.js";
import { buildTemplateZpl } from "../utils/Zpltemplate.js";


export const updatePrintJobStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, error_message } = req.body;

  const ALLOWED = ["PRINTED", "FAILED"];
  if (!ALLOWED.includes(status)) {
    throw new AppError(`status must be one of: ${ALLOWED.join(", ")}`, 400);
  }

  await pool.query(
    `UPDATE box_print_jobs
     SET status = ?, error_message = ?, printed_at = ?, attempts = attempts + 1, updated_at = NOW()
     WHERE id = ?`,
    [status, error_message || null, status === "PRINTED" ? new Date() : null, id]
  );

  const [rows] = await pool.query(`SELECT * FROM box_print_jobs WHERE id = ?`, [id]);
  if (!rows.length) throw new AppError("Print job not found", 404);

  res.status(200).json(rows[0]);
});


export const getBoxPrintJobZpl = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [rows] = await pool.query(
    `
    SELECT
      bpj.id AS print_job_id,
      bpj.box_id,
      bpj.printer_id,
      bpj.barcode_data,

      b.box_code,
      b.product_id,
      b.packaging_stage_id,
      b.actual_quantity,
      b.box_size,
      b.packed_at,

      p.name AS product_name,
      p.part_code,
      p.erp_no,

      pc.id AS packaging_config_id,
      pc.label_template_id,

      lt.id AS template_id,
      lt.name AS template_name,
      lt.template_type,
      lt.dpi,
      lt.width,
      lt.height,
      lt.pitch_x,
      lt.pitch_y,
      lt.elements

    FROM box_print_jobs bpj

    JOIN boxes b
      ON b.id = bpj.box_id

    LEFT JOIN products p
      ON p.id = b.product_id

    JOIN packaging_config pc
      ON pc.product_id = b.product_id
     AND pc.stage_id = b.packaging_stage_id
     AND pc.is_active = 1

    JOIN label_templates lt
      ON lt.id = pc.label_template_id
     AND lt.template_type = 'BOX_LABEL'
     AND lt.is_active = 1

    WHERE bpj.id = ?

    LIMIT 1
    `,
    [id]
  );

  if (!rows.length) {
    throw new AppError(
      "Print job or active Master Label configuration not found",
      404
    );
  }

  const row = rows[0];

  let elements = row.elements;

  if (typeof elements === "string") {
    try {
      elements = JSON.parse(elements);
    } catch {
      throw new AppError(
        "Master Label template contains invalid elements JSON",
        500
      );
    }
  }

  const template = {
    id: row.template_id,
    name: row.template_name,
    template_type: row.template_type,
    dpi: row.dpi,
    width: row.width,
    height: row.height,
    pitch_x: row.pitch_x,
    pitch_y: row.pitch_y,
    elements,
  };

  const testData = {
    box_qr: row.barcode_data || "",
    product_name: row.product_name || "",
    part_code: row.part_code || "",
    erp_no: row.erp_no || "",
    quantity: row.actual_quantity ?? "",
    packed_at: row.packed_at || "",
  };

  const zpl = buildTemplateZpl({
    template,
    testData,
  });

  res.status(200).json({
    data: {
      print_job_id: row.print_job_id,
      printer_id: row.printer_id,
      box_id: row.box_id,
      box_code: row.box_code,
      packaging_config_id: row.packaging_config_id,
      template_id: row.template_id,
      template_name: row.template_name,
      zpl,
    },
  });
});

// controllers/print.controller.js
export const getStagePrintConfig = async (req, res) => {
  try {
    const product_id = Number(req.query.product_id);
    const stage_id = Number(req.query.stage_id);

    if (!product_id || !stage_id) {
      return res
        .status(400)
        .json({ success: false, message: "product_id and stage_id are required" });
    }

    // Same condition submitScan uses to decide isPackagingStage
    const [rows] = await pool.query(
      `
      SELECT id, box_size, barcode_format
      FROM packaging_config
      WHERE product_id = ?
        AND stage_id = ?
        AND is_active = 1
      LIMIT 1
      `,
      [product_id, stage_id]
    );

    return res.json({
      success: true,
      data: {
        supports_print: rows.length > 0,
        box_size: rows[0]?.box_size ?? null,
        barcode_format: rows[0]?.barcode_format ?? null,
      },
    });
  } catch (err) {
    console.error("stage-print-config error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to load print config" });
  }
};

// controllers/print.controller.js
export const getRecentBoxPrintJobs = async (req, res) => {
  try {
    const product_id = Number(req.query.product_id);
    const stage_id = Number(req.query.stage_id);
    if (!product_id || !stage_id) {
      return res.status(400).json({ success: false, message: "product_id and stage_id are required" });
    }

    const [rows] = await pool.query(
      `
      SELECT
        bpj.id AS print_job_id,
        bpj.status,
        bpj.barcode_data,
        b.box_code,
        b.actual_quantity,
        b.packed_at
      FROM box_print_jobs bpj
      JOIN boxes b ON b.id = bpj.box_id
      WHERE b.product_id = ?
        AND b.packaging_stage_id = ?
      ORDER BY bpj.id DESC
      LIMIT 10
      `,
      [product_id, stage_id]
    );

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error("recent box print jobs error:", err);
    return res.status(500).json({ success: false, message: "Failed to load recent labels" });
  }
};