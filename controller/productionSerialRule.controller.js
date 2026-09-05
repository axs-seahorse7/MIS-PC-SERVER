import { pool } from "../DB/config/mysql.config.js";
import { asyncHandler, AppError } from "../utils/AppError.js";

const SEGMENT_TYPES = ["STATIC", "PRODUCT_FIELD", "DATE", "SERIAL"];
const DATE_PARTS = ["YYYY", "YY", "MM", "DD", "WW"];
const PRODUCT_FIELDS = ["name", "part_code", "erp_no"];

const getISOWeekData = (date = new Date()) => {
  const d = new Date(Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  ));

  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);

  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);

  return { year, week };
};

const validateProductionSerialRule = (rule) => {
  if (!Array.isArray(rule) || rule.length === 0) {
    return "rule must be a non-empty array of segments";
  }

  const serialSegments = rule.filter(
    (segment) => segment?.type === "SERIAL"
  );

  if (serialSegments.length === 0) {
    return "rule must include exactly one SERIAL segment";
  }

  if (serialSegments.length > 1) {
    return "rule can only include one SERIAL segment";
  }

  for (const segment of rule) {
    if (!segment || !SEGMENT_TYPES.includes(segment.type)) {
      return `Invalid segment type: ${segment?.type}`;
    }

    if (segment.type === "STATIC") {
      if (!segment.value || !String(segment.value).trim()) {
        return "STATIC segment requires a non-empty value";
      }
    }

    if (segment.type === "PRODUCT_FIELD") {
      if (!PRODUCT_FIELDS.includes(segment.field)) {
        return `PRODUCT_FIELD field must be one of: ${PRODUCT_FIELDS.join(", ")}`;
      }
    }

    if (segment.type === "DATE") {
      if (!Array.isArray(segment.parts) || !segment.parts.length) {
        return "DATE segment requires at least one part";
      }

      if (segment.parts.some((part) => !DATE_PARTS.includes(part))) {
        return `DATE segment parts must be one of: ${DATE_PARTS.join(", ")}`;
      }
    }

    if (segment.type === "SERIAL") {
      const width = Number(segment.width);

      if (!Number.isInteger(width) || width < 1 || width > 5) {
        return "SERIAL width must be between 1 and 5";
      }
    }
  }

  return null;
};

// GET /api/production-serial-rules
export const getAllProductionSerialRules = asyncHandler(
  async (req, res) => {
    const [rows] = await pool.query(
      `
      SELECT
        psr.id,
        psr.product_id,
        p.name AS product_name,
        p.part_code,
        p.erp_no,

        psr.rule,
        psr.current_year,
        psr.current_week,
        psr.next_serial,
        psr.is_active,
        psr.created_at,
        psr.updated_at

      FROM production_serial_rules psr

      LEFT JOIN products p
        ON p.id = psr.product_id

      ORDER BY psr.updated_at DESC
      `
    );

    res.status(200).json(rows);
  }
);


// GET /api/production-serial-rules/:id
export const getProductionSerialRuleById = asyncHandler(
  async (req, res) => {
    const { id } = req.params;

    const [rows] = await pool.query(
      `
      SELECT
        psr.id,
        psr.product_id,
        p.name AS product_name,
        p.part_code,
        p.erp_no,

        psr.rule,
        psr.current_year,
        psr.current_week,
        psr.next_serial,
        psr.is_active,
        psr.created_at,
        psr.updated_at

      FROM production_serial_rules psr

      LEFT JOIN products p
        ON p.id = psr.product_id

      WHERE psr.id = ?
      LIMIT 1
      `,
      [id]
    );

    if (!rows.length) {
      throw new AppError(
        "Production serial rule not found",
        404
      );
    }

    res.status(200).json(rows[0]);
  }
);

// POST /api/production-serial-rules
export const createProductionSerialRule = asyncHandler(
  async (req, res) => {
    const {
      product_id,
      rule,
      is_active = true,
    } = req.body;

    if (!product_id || !rule) {
      throw new AppError(
        "product_id and rule are required",
        400
      );
    }

    const ruleError = validateProductionSerialRule(rule);

    if (ruleError) {
      throw new AppError(ruleError, 400);
    }

    // Validate product
    const [productRows] = await pool.query(
      `
      SELECT id, name, part_code, erp_no
      FROM products
      WHERE id = ?
        AND is_active = 1
      LIMIT 1
      `,
      [product_id]
    );

    if (!productRows.length) {
      throw new AppError(
        "Invalid or inactive product",
        400
      );
    }

    // One rule per product
    const [existing] = await pool.query(
      `
      SELECT id
      FROM production_serial_rules
      WHERE product_id = ?
      LIMIT 1
      `,
      [product_id]
    );

    if (existing.length) {
      throw new AppError(
        "A production serial rule already exists for this product",
        409
      );
    }

    const { year, week } = getISOWeekData();

    const [result] = await pool.query(
      `
      INSERT INTO production_serial_rules
      (
        product_id,
        rule,
        current_year,
        current_week,
        next_serial,
        is_active,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, 1, ?, NOW(), NOW())
      `,
      [
        product_id,
        JSON.stringify(rule),
        year,
        week,
        is_active,
      ]
    );

    const [rows] = await pool.query(
      `
      SELECT
        psr.*,
        p.name AS product_name,
        p.part_code,
        p.erp_no
      FROM production_serial_rules psr
      LEFT JOIN products p
        ON p.id = psr.product_id
      WHERE psr.id = ?
      LIMIT 1
      `,
      [result.insertId]
    );

    res.status(201).json(rows[0]);
  }
);

// PUT /api/production-serial-rules/:id
export const updateProductionSerialRule = asyncHandler(
  async (req, res) => {
    const { id } = req.params;

    const {
      product_id,
      rule,
      is_active,
    } = req.body;

    if (!product_id || !rule) {
      throw new AppError(
        "product_id and rule are required",
        400
      );
    }

    const ruleError = validateProductionSerialRule(rule);

    if (ruleError) {
      throw new AppError(ruleError, 400);
    }

    const [existing] = await pool.query(
      `
      SELECT id
      FROM production_serial_rules
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );

    if (!existing.length) {
      throw new AppError(
        "Production serial rule not found",
        404
      );
    }

    // Validate product
    const [productRows] = await pool.query(
      `
      SELECT id
      FROM products
      WHERE id = ?
        AND is_active = 1
      LIMIT 1
      `,
      [product_id]
    );

    if (!productRows.length) {
      throw new AppError(
        "Invalid or inactive product",
        400
      );
    }

    // Prevent another rule for the same product
    const [duplicate] = await pool.query(
      `
      SELECT id
      FROM production_serial_rules
      WHERE product_id = ?
        AND id != ?
      LIMIT 1
      `,
      [product_id, id]
    );

    if (duplicate.length) {
      throw new AppError(
        "A production serial rule already exists for this product",
        409
      );
    }

    await pool.query(
      `
      UPDATE production_serial_rules
      SET
        product_id = ?,
        rule = ?,
        is_active = ?,
        updated_at = NOW()
      WHERE id = ?
      `,
      [
        product_id,
        JSON.stringify(rule),
        is_active ?? true,
        id,
      ]
    );

    const [rows] = await pool.query(
      `
      SELECT
        psr.*,
        p.name AS product_name,
        p.part_code,
        p.erp_no
      FROM production_serial_rules psr
      LEFT JOIN products p
        ON p.id = psr.product_id
      WHERE psr.id = ?
      LIMIT 1
      `,
      [id]
    );

    res.status(200).json(rows[0]);
  }
);

// PATCH /api/production-serial-rules/:id
export const patchProductionSerialRule = asyncHandler(
  async (req, res) => {
    const { id } = req.params;

    const allowedFields = [
      "product_id",
      "rule",
      "is_active",
    ];

    const updates = Object.entries(req.body).filter(
      ([key]) => allowedFields.includes(key)
    );

    if (!updates.length) {
      throw new AppError(
        "No valid fields provided to update",
        400
      );
    }

    const [existing] = await pool.query(
      `
      SELECT id
      FROM production_serial_rules
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );

    if (!existing.length) {
      throw new AppError(
        "Production serial rule not found",
        404
      );
    }

    // Validate product if being changed
    const productUpdate = updates.find(
      ([key]) => key === "product_id"
    );

    if (productUpdate) {
      const [productRows] = await pool.query(
        `
        SELECT id
        FROM products
        WHERE id = ?
          AND is_active = 1
        LIMIT 1
        `,
        [productUpdate[1]]
      );

      if (!productRows.length) {
        throw new AppError(
          "Invalid or inactive product",
          400
        );
      }

      // Prevent duplicate product rule
      const [duplicate] = await pool.query(
        `
        SELECT id
        FROM production_serial_rules
        WHERE product_id = ?
          AND id != ?
        LIMIT 1
        `,
        [productUpdate[1], id]
      );

      if (duplicate.length) {
        throw new AppError(
          "A production serial rule already exists for this product",
          409
        );
      }
    }

    // Validate rule if being changed
    const ruleUpdate = updates.find(
      ([key]) => key === "rule"
    );

    if (ruleUpdate) {
      const ruleError = validateProductionSerialRule(
        ruleUpdate[1]
      );

      if (ruleError) {
        throw new AppError(ruleError, 400);
      }
    }

    const setClause = updates
      .map(([key]) => `${key} = ?`)
      .join(", ");

    const values = updates.map(([key, value]) =>
      key === "rule"
        ? JSON.stringify(value)
        : value
    );

    await pool.query(
      `
      UPDATE production_serial_rules
      SET ${setClause},
          updated_at = NOW()
      WHERE id = ?
      `,
      [...values, id]
    );

    const [rows] = await pool.query(
      `
      SELECT
        psr.*,
        p.name AS product_name,
        p.part_code,
        p.erp_no
      FROM production_serial_rules psr
      LEFT JOIN products p
        ON p.id = psr.product_id
      WHERE psr.id = ?
      LIMIT 1
      `,
      [id]
    );

    res.status(200).json(rows[0]);
  }
);

// DELETE /api/production-serial-rules/:id
export const deleteProductionSerialRule = asyncHandler(
  async (req, res) => {
    const { id } = req.params;

    const [existing] = await pool.query(
      `
      SELECT id
      FROM production_serial_rules
      WHERE id = ?
      LIMIT 1
      `,
      [id]
    );

    if (!existing.length) {
      throw new AppError(
        "Production serial rule not found",
        404
      );
    }

    await pool.query(
      `
      DELETE FROM production_serial_rules
      WHERE id = ?
      `,
      [id]
    );

    res.status(200).json({
      message: "Production serial rule deleted",
    });
  }
);