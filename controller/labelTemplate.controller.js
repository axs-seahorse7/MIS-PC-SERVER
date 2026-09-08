// controller/labelTemplate.controller.js

import pool from "../DB/config/mysql.config.js";
import {asyncHandler, AppError}  from "../utils/AppError.js";

const TEMPLATE_TYPES = ["PCB_QR", "BOX_LABEL", "CUSTOMER_QR", "PRODUCT_QR"];

const formatTemplateDate = (format = "DD/MM/YY") => {
  const date = new Date();

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  const shortYear = year.slice(-2);

  const monthsShort = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  const monthsLong = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const replacements = {
    DD: day,
    MMMM: monthsLong[date.getMonth()],
    MMM: monthsShort[date.getMonth()],
    MM: month,
    YYYY: year,
    YY: shortYear
  };

  return format.replace(
    /YYYY|MMMM|MMM|MM|DD|YY/g,
    (token) => replacements[token]
  );
};

const resolveTextValue = (element, testData = {}) => {
  switch (element.source) {
    case "manual":
      return element.text ?? "";

    case "date":
      return formatTemplateDate(element.dateFormat || "DD/MM/YY");

    case "field":
    default:
      return testData[element.field] ?? "";
  }
};

const validateTemplateType = (type) => {
  if (!TEMPLATE_TYPES.includes(type)) {
    throw new AppError(
      `template_type must be one of: ${TEMPLATE_TYPES.join(", ")}`,
      400
    );
  }
};

const validateElements = (elements) => {
  if (!Array.isArray(elements)) {
    throw new AppError("elements must be an array", 400);
  }

  for (const [index, element] of elements.entries()) {
    if (!element || typeof element !== "object") {
      throw new AppError(
        `Element ${index + 1} must be an object`,
        400
      );
    }

    if (!["text", "qr", "line", "box"].includes(element.type)) {
      throw new AppError(
        `Element ${index + 1} has invalid type`,
        400
      );
    }

    if (element.type === "text") {
      const source = element.source || "field";

      if (!["manual", "field", "date"].includes(source)) {
        throw new AppError(
          `Element ${index + 1} has invalid text source`,
          400
        );
      }

      if (source === "manual" && !String(element.text ?? "").trim()) {
        throw new AppError(
          `Element ${index + 1}: manual text is required`,
          400
        );
      }

      if (source === "field" && !String(element.field ?? "").trim()) {
        throw new AppError(
          `Element ${index + 1}: field is required`,
          400
        );
      }

      if (source === "date" && !String(element.dateFormat ?? "").trim()) {
        throw new AppError(
          `Element ${index + 1}: dateFormat is required`,
          400
        );
      }

      if (element.type === "line") {
  if (!["horizontal", "vertical"].includes(element.direction)) {
    throw new AppError("Invalid line direction", 400);
  }

  if (!Number.isFinite(Number(element.x)) || !Number.isFinite(Number(element.y))) {
    throw new AppError("Line x/y are required", 400);
  }

  if (element.direction === "horizontal") {
    if (!Number.isFinite(Number(element.width)) || Number(element.width) <= 0) {
      throw new AppError("Horizontal line width must be greater than 0", 400);
    }
  } else {
    if (!Number.isFinite(Number(element.height)) || Number(element.height) <= 0) {
      throw new AppError("Vertical line height must be greater than 0", 400);
    }
  }

  if (!Number.isFinite(Number(element.thickness)) || Number(element.thickness) <= 0) {
    throw new AppError("Line thickness must be greater than 0", 400);
  }
}

  if (element.type === "box") {
    if (!Number.isFinite(Number(element.x)) || !Number.isFinite(Number(element.y))) {
      throw new AppError("Box x/y are required", 400);
    }

    if (!Number.isFinite(Number(element.width)) || Number(element.width) <= 0) {
      throw new AppError("Box width must be greater than 0", 400);
    }

    if (!Number.isFinite(Number(element.height)) || Number(element.height) <= 0) {
      throw new AppError("Box height must be greater than 0", 400);
    }

    if (!Number.isFinite(Number(element.thickness)) || Number(element.thickness) <= 0) {
      throw new AppError("Box thickness must be greater than 0", 400);
    }
  }
    }

    if (element.type === "qr") {
      if (!String(element.field ?? "").trim()) {
        throw new AppError(
          `Element ${index + 1}: QR field is required`,
          400
        );
      }
    }
  }
};

const normalizeNumber = (value, field, required = true) => {
  if (value === null || value === undefined || value === "") {
    if (required) {
      throw new AppError(`${field} is required`, 400);
    }
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new AppError(`${field} must be a valid positive number`, 400);
  }

  return number;
};


// ============================================================
// GET ALL TEMPLATES
// ============================================================

export const getLabelTemplates = asyncHandler(async (req, res) => {
  const { type, active } = req.query;

  let sql = `
    SELECT
      lt.id,
      lt.name,
      lt.template_type,
      lt.dpi,
      lt.width,
      lt.height,
      lt.pitch_x,
      lt.pitch_y,
      lt.elements,
      lt.is_active,
      lt.created_by,
      lt.created_at,
      lt.updated_at
    FROM label_templates lt
    WHERE 1 = 1
  `;

  const params = [];

  if (type) {
    validateTemplateType(type);
    sql += ` AND lt.template_type = ?`;
    params.push(type);
  }

  if (active !== undefined) {
    sql += ` AND lt.is_active = ?`;
    params.push(active === "true" || active === "1" ? 1 : 0);
  }

  sql += ` ORDER BY lt.created_at DESC`;

  const [rows] = await pool.query(sql, params);

  res.json({
    data: rows,
  });
});

export const getLabelTemplateByTemplateType = asyncHandler(async (req, res) => {
  const { type } = req.params;

  const VALID_TEMPLATE_TYPES = ["PCB_QR", "BOX_LABEL", "CUSTOMER_QR"];

  if (!VALID_TEMPLATE_TYPES.includes(type)) {
    throw new AppError(
      `template_type must be one of: ${VALID_TEMPLATE_TYPES.join(", ")}`,
      400
    );
  }

  const [rows] = await pool.query(
    `
    SELECT id, name, template_type, dpi, width, height, pitch_x, pitch_y
    FROM label_templates
    WHERE template_type = ?
      AND is_active = 1
    ORDER BY name ASC
    `,
    [type]
  );

  res.status(200).json(rows);
});

// ============================================================
// GET TEMPLATE BY ID
// ============================================================

export const getLabelTemplateById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [rows] = await pool.query(
    `
      SELECT
        lt.id,
        lt.name,
        lt.template_type,
        lt.dpi,
        lt.width,
        lt.height,
        lt.pitch_x,
        lt.pitch_y,
        lt.elements,
        lt.is_active,
        lt.created_by,
        lt.created_at,
        lt.updated_at
      FROM label_templates lt
      WHERE lt.id = ?
    `,
    [id]
  );

  if (!rows.length) {
    throw new AppError("Label template not found", 404);
  }

  res.json({
    data: rows[0],
  });
});


// ============================================================
// CREATE TEMPLATE
// ============================================================

export const createLabelTemplate = asyncHandler(async (req, res) => {
  const {
    name,
    template_type,
    dpi,
    width,
    height,
    pitch_x,
    pitch_y,
    elements,
  } = req.body;

  if (!name || !String(name).trim()) {
    throw new AppError("Template name is required", 400);
  }

  validateTemplateType(template_type);
  validateElements(elements);

  const templateDpi = normalizeNumber(dpi, "dpi");
  const templateWidth = normalizeNumber(width, "width");
  const templateHeight = normalizeNumber(height, "height");

  const pitchX = normalizeNumber(pitch_x, "pitch_x", false);
  const pitchY = normalizeNumber(pitch_y, "pitch_y", false);

  const [result] = await pool.query(
    `
      INSERT INTO label_templates (
        name,
        template_type,
        dpi,
        width,
        height,
        pitch_x,
        pitch_y,
        elements,
        is_active,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `,
    [
      String(name).trim(),
      template_type,
      templateDpi,
      templateWidth,
      templateHeight,
      pitchX,
      pitchY,
      JSON.stringify(elements),
      req.user?.id ?? null,
    ]
  );

  const [rows] = await pool.query(
    `
      SELECT *
      FROM label_templates
      WHERE id = ?
    `,
    [result.insertId]
  );

  res.status(201).json({
    message: "Label template created successfully",
    data: rows[0],
  });
});


// ============================================================
// UPDATE TEMPLATE
// ============================================================

export const updateLabelTemplate = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [existingRows] = await pool.query(
    `
      SELECT *
      FROM label_templates
      WHERE id = ?
    `,
    [id]
  );

  if (!existingRows.length) {
    throw new AppError("Label template not found", 404);
  }

  const existing = existingRows[0];

  const {
    name,
    template_type,
    dpi,
    width,
    height,
    pitch_x,
    pitch_y,
    elements,
    is_active,
  } = req.body;

  const nextName =
    name !== undefined ? String(name).trim() : existing.name;

  if (!nextName) {
    throw new AppError("Template name is required", 400);
  }

  const nextType =
    template_type !== undefined
      ? template_type
      : existing.template_type;

  validateTemplateType(nextType);

  const nextDpi =
    dpi !== undefined
      ? normalizeNumber(dpi, "dpi")
      : existing.dpi;

  const nextWidth =
    width !== undefined
      ? normalizeNumber(width, "width")
      : existing.width;

  const nextHeight =
    height !== undefined
      ? normalizeNumber(height, "height")
      : existing.height;

  const nextPitchX =
    pitch_x !== undefined
      ? normalizeNumber(pitch_x, "pitch_x", false)
      : existing.pitch_x;

  const nextPitchY =
    pitch_y !== undefined
      ? normalizeNumber(pitch_y, "pitch_y", false)
      : existing.pitch_y;

  const nextElements =
    elements !== undefined
      ? (() => {
          validateElements(elements);
          return JSON.stringify(elements);
        })()
      : existing.elements;

  const nextActive =
    is_active !== undefined
      ? is_active ? 1 : 0
      : existing.is_active;

  await pool.query(
    `
      UPDATE label_templates
      SET
        name = ?,
        template_type = ?,
        dpi = ?,
        width = ?,
        height = ?,
        pitch_x = ?,
        pitch_y = ?,
        elements = ?,
        is_active = ?,
        updated_at = NOW()
      WHERE id = ?
    `,
    [
      nextName,
      nextType,
      nextDpi,
      nextWidth,
      nextHeight,
      nextPitchX,
      nextPitchY,
      nextElements,
      nextActive,
      id,
    ]
  );

  const [rows] = await pool.query(
    `
      SELECT *
      FROM label_templates
      WHERE id = ?
    `,
    [id]
  );

  res.json({
    message: "Label template updated successfully",
    data: rows[0],
  });
});


// ============================================================
// DELETE / DEACTIVATE TEMPLATE
// ============================================================

export const deleteLabelTemplate = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [rows] = await pool.query(
    `
      SELECT id, name, is_active
      FROM label_templates
      WHERE id = ?
    `,
    [id]
  );

  if (!rows.length) {
    throw new AppError("Label template not found", 404);
  }

  await pool.query(
    `
      UPDATE label_templates
      SET
        is_active = 0,
        updated_at = NOW()
      WHERE id = ?
    `,
    [id]
  );

  res.json({
    message: "Label template deactivated successfully",
  });
});


// ============================================================
// GET PRINTER TEMPLATE ASSIGNMENTS
// ============================================================

export const getPrinterLabelTemplates = asyncHandler(
  async (req, res) => {
    const { printerId } = req.params;

    const [printerRows] = await pool.query(
      `
        SELECT
          id,
          name,
          printer_type,
          printer_name,
          is_active
        FROM printers
        WHERE id = ?
      `,
      [printerId]
    );

    if (!printerRows.length) {
      throw new AppError("Printer not found", 404);
    }

    const [rows] = await pool.query(
      `
        SELECT
          plt.id,
          plt.printer_id,
          plt.template_id,
          plt.template_type,
          lt.name AS template_name,
          lt.dpi,
          lt.width,
          lt.height,
          lt.is_active AS template_active
        FROM printer_label_templates plt
        JOIN label_templates lt
          ON lt.id = plt.template_id
        WHERE plt.printer_id = ?
        ORDER BY plt.template_type
      `,
      [printerId]
    );

    res.json({
      data: {
        printer: printerRows[0],
        templates: rows,
      },
    });
  }
);


// ============================================================
// ASSIGN TEMPLATE TO PRINTER
// ============================================================

export const assignPrinterLabelTemplate = asyncHandler(
  async (req, res) => {
    const { printerId } = req.params;
    const { template_id, template_type } = req.body;

    if (!template_id) {
      throw new AppError("template_id is required", 400);
    }

    if (!template_type) {
      throw new AppError("template_type is required", 400);
    }

    validateTemplateType(template_type);

    const [printerRows] = await pool.query(
      `
        SELECT id, name, printer_name, is_active
        FROM printers
        WHERE id = ?
      `,
      [printerId]
    );

    if (!printerRows.length) {
      throw new AppError("Printer not found", 404);
    }

    if (!printerRows[0].is_active) {
      throw new AppError("Printer is inactive", 409);
    }

    const [templateRows] = await pool.query(
      `
        SELECT
          id,
          name,
          template_type,
          dpi,
          is_active
        FROM label_templates
        WHERE id = ?
      `,
      [template_id]
    );

    if (!templateRows.length) {
      throw new AppError("Label template not found", 404);
    }

    const template = templateRows[0];

    if (!template.is_active) {
      throw new AppError("Selected template is inactive", 409);
    }

    if (template.template_type !== template_type) {
      throw new AppError(
        `Template type mismatch. Template is ${template.template_type}.`,
        400
      );
    }

    await pool.query(
      `
        INSERT INTO printer_label_templates (
          printer_id,
          template_id,
          template_type
        )
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          template_id = VALUES(template_id)
      `,
      [
        printerId,
        template_id,
        template_type,
      ]
    );

    const [rows] = await pool.query(
      `
        SELECT
          plt.id,
          plt.printer_id,
          plt.template_id,
          plt.template_type,
          lt.name AS template_name,
          lt.dpi,
          lt.width,
          lt.height
        FROM printer_label_templates plt
        JOIN label_templates lt
          ON lt.id = plt.template_id
        WHERE plt.printer_id = ?
          AND plt.template_type = ?
      `,
      [printerId, template_type]
    );

    res.json({
      message: "Label template assigned to printer successfully",
      data: rows[0],
    });
  }
);


// ============================================================
// REMOVE PRINTER TEMPLATE ASSIGNMENT
// ============================================================

export const removePrinterLabelTemplate = asyncHandler(
  async (req, res) => {
    const { printerId, templateType } = req.params;

    validateTemplateType(templateType);

    const [result] = await pool.query(
      `
        DELETE FROM printer_label_templates
        WHERE printer_id = ?
          AND template_type = ?
      `,
      [printerId, templateType]
    );

    if (!result.affectedRows) {
      throw new AppError(
        "No template assignment found for this printer and type",
        404
      );
    }

    res.json({
      message: "Label template assignment removed successfully",
    });
  }
);

// ============================================================
// ZPL HELPERS
// ============================================================

const escapeZpl = (value) =>
  String(value ?? "")
    .replace(/[\^~]/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();


const getRotation = (rotation) => {
  const deg = Number(rotation) || 0;
  if (deg === 90) return "R";
  if (deg === 180) return "I";
  if (deg === 270) return "B";
  return "N";
};


// ============================================================
// TEMPLATE -> ZPL
// ============================================================

const buildTemplateZpl = ({ template, testData = {} }) => {
  if (!template || typeof template !== "object") {
    throw new AppError("template is required", 400);
  }

  if (!Array.isArray(template.elements)) {
    throw new AppError("template.elements must be an array", 400);
  }

  const width = Number(template.width);
  const height = Number(template.height);

  if (!Number.isFinite(width) || width <= 0) {
    throw new AppError("Invalid template width", 400);
  }

  if (!Number.isFinite(height) || height <= 0) {
    throw new AppError("Invalid template height", 400);
  }

  let zpl =
    "^XA" +
    `^PW${Math.round(width)}` +
    `^LL${Math.round(height)}` +
    "^LH0,0" +
    "^LS0" +
    "^CI28";

  for (const element of template.elements) {
    if (!element || !element.type) continue;

    const x = Math.max(0, Math.round(Number(element.x) || 0));
    const y = Math.max(0, Math.round(Number(element.y) || 0));

    const value = escapeZpl(
      resolveTextValue(element, testData)
    );

    // --------------------------------------------------------
    // TEXT
    // --------------------------------------------------------

    if (element.type === "text") {
      const fontSize = Math.max(
        1,
        Math.round(Number(element.fontSize) || 20)
      );

      const rotation = getRotation(element.rotation);

      zpl +=
        `^FO${x},${y}` +
        `^A0${rotation},${fontSize},${fontSize}` +
        `^FD${value}^FS`;

      continue;
    }

    // --------------------------------------------------------
    // QR
    // --------------------------------------------------------

    if (element.type === "qr") {
      const scale = Math.min(
        10,
        Math.max(
          1,
          Math.round(Number(element.scale) || 3)
        )
      );

      const rotation = getRotation(element.rotation);

      zpl +=
        `^FO${x},${y}` +
        `^BQN,${rotation},${scale}` +
        `^FDQA,${value}^FS`;

      continue;
    }

    // --------------------------------------------------------
    // LINE
    // --------------------------------------------------------

    if (element.type === "line") {
      const thickness = Math.max(
        1,
        Math.round(Number(element.thickness) || 1)
      );

      if (element.direction === "vertical") {
        const lineHeight = Math.max(
          1,
          Math.round(Number(element.height) || 1)
        );

        zpl +=
          `^FO${x},${y}` +
          `^GB${thickness},${lineHeight},${thickness}^FS`;
      } else {
        const lineWidth = Math.max(
          1,
          Math.round(Number(element.width) || 1)
        );

        zpl +=
          `^FO${x},${y}` +
          `^GB${lineWidth},${thickness},${thickness}^FS`;
      }

      continue;
    }

    // --------------------------------------------------------
    // BOX
    // --------------------------------------------------------

    if (element.type === "box") {
      const boxWidth = Math.max(
        1,
        Math.round(Number(element.width) || 1)
      );

      const boxHeight = Math.max(
        1,
        Math.round(Number(element.height) || 1)
      );

      const thickness = Math.max(
        1,
        Math.round(Number(element.thickness) || 1)
      );

      zpl +=
        `^FO${x},${y}` +
        `^GB${boxWidth},${boxHeight},${thickness}^FS`;

      continue;
    }
  }

  zpl += "^XZ";

  return zpl;
};

// ============================================================
// TEST PRINT
// ============================================================

export const testPrintLabelTemplate = asyncHandler(
  async (req, res) => {
    const {
      template,
      printer_id,
      test_data = {},
    } = req.body;

    if (!template) {
      throw new AppError(
        "template is required",
        400
      );
    }

    if (!printer_id) {
      throw new AppError(
        "printer_id is required",
        400
      );
    }

    // --------------------------------------------------------
    // Validate printer
    // --------------------------------------------------------

    const [printerRows] = await pool.query(
      `
        SELECT
          id,
          name,
          printer_type,
          printer_name,
          is_active
        FROM printers
        WHERE id = ?
      `,
      [printer_id]
    );

    if (!printerRows.length) {
      throw new AppError(
        "Printer not found",
        404
      );
    }

    const printer = printerRows[0];

    if (!printer.is_active) {
      throw new AppError(
        "Selected printer is inactive",
        409
      );
    }

    if (!printer.printer_name) {
      throw new AppError(
        "Selected printer queue name is not configured",
        409
      );
    }

    // --------------------------------------------------------
    // Validate template
    // --------------------------------------------------------

    const validTypes = [
      "PRODUCT_QR",
      "PCB_QR",
      "BOX_LABEL",
      "CUSTOMER_QR",
    ];

    if (
      !validTypes.includes(
        template.template_type
      )
    ) {
      throw new AppError(
        "Invalid template_type",
        400
      );
    }

    if (!Number.isFinite(Number(template.dpi))) {
      throw new AppError(
        "Invalid template DPI",
        400
      );
    }

    if (
      !Number.isFinite(Number(template.width)) ||
      Number(template.width) <= 0
    ) {
      throw new AppError(
        "Invalid template width",
        400
      );
    }

    if (
      !Number.isFinite(Number(template.height)) ||
      Number(template.height) <= 0
    ) {
      throw new AppError(
        "Invalid template height",
        400
      );
    }

    // --------------------------------------------------------
    // Generate ZPL
    // --------------------------------------------------------

    const zpl = buildTemplateZpl({
      template,
      testData: test_data,
    });

    // --------------------------------------------------------
    // Return only
    //
    // NO DB INSERT
    // NO SERIAL RESERVATION
    // NO PRINT STATUS
    // --------------------------------------------------------

    res.json({
      data: {
        zpl,
        printer_id: printer.id,
        printer_name: printer.printer_name,
        template_type: template.template_type,
      },
    });
  }
);


// when a user will create a Customer Label then there should be, both option for part_code, from customer table and from product table, both have part_code, so both should be in option .