import { pool } from "../DB/config/mysql.config.js";

export const createProducts = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const {
      categoryId,
      name,
      description,
      remarks,
      autoGenerateErp,
      erpNo: manualErpNo,
      partCode,
    } = req.body;

    if (!categoryId) {
      return res.status(400).json({
        message: "Category is required",
      });
    }

    if (!name?.trim()) {
      return res.status(400).json({
        message: "Product name is required",
      });
    }

    // Manual mode requires an ERP No up front — fail fast before opening
    // a transaction if it's missing.
    if (!autoGenerateErp && !manualErpNo?.trim()) {
      return res.status(400).json({
        message: "ERP No is required, or enable auto-generate",
      });
    }

    await connection.beginTransaction();

    // Get category name
    const [categoryRows] = await connection.query(
      `SELECT name FROM categories WHERE id = ?`,
      [categoryId]
    );

    if (categoryRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        message: "Category not found",
      });
    }

    const categoryName = categoryRows[0].name;

    let erpNo;

    if (autoGenerateErp) {
      // First 2 letters of category name
      const prefix = categoryName
        .replace(/[^a-zA-Z]/g, "")
        .substring(0, 2)
        .toUpperCase();

      if (prefix.length < 2) {
        await connection.rollback();

        return res.status(400).json({
          message: "Category name must contain at least 2 letters",
        });
      }

      const now = new Date();

      const year = now.getFullYear().toString().slice(-2);
      const month = String(now.getMonth() + 1).padStart(2, "0");

      const codePrefix = `${prefix}${year}${month}`;

      const [rows] = await connection.query(
        `
        SELECT erp_no
        FROM products
        WHERE category_id = ?
          AND erp_no LIKE ?
        ORDER BY CAST(SUBSTRING(erp_no, 7) AS UNSIGNED) DESC
        LIMIT 1
        FOR UPDATE
        `,
        [categoryId, `${codePrefix}%`]
      );

      let nextNumber = 1;

      if (rows.length > 0) {
        nextNumber = parseInt(rows[0].erp_no.substring(6), 10) + 1;
      }

      erpNo = `${codePrefix}${String(nextNumber).padStart(4, "0")}`;
    } else {
      // Manual mode — use exactly what the user typed. Lock any existing
      // row with this erp_no so a concurrent request can't sneak the same
      // code in between our check and our insert.
      erpNo = manualErpNo.trim().toUpperCase();

      const [existing] = await connection.query(
        `SELECT id FROM products WHERE erp_no = ? FOR UPDATE`,
        [erpNo]
      );

      if (existing.length > 0) {
        await connection.rollback();

        return res.status(409).json({
          message: "ERP code already exists",
        });
      }
    }

    const [result] = await connection.query(
      `
      INSERT INTO products
        (category_id, name, description, remarks, erp_no, part_code)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        categoryId,
        name.trim().toUpperCase(),
        description || null,
        remarks || null,
        erpNo,
        partCode || null,
      ]
    );

    await connection.commit();

    return res.status(201).json({
      message: "Product created successfully",
      id: result.insertId,
      erpNo,
    });

  } catch (error) {
    await connection.rollback();

    console.error("ERR IN CREATE PRODUCT:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "ERP code already exists",
      });
    }

    return res.status(500).json({
      message: error.message,
    });

  } finally {
    connection.release();
  }
};

export const updateProduct = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const { id } = req.params;
    const {
      categoryId,
      name,
      description,
      remarks,
      autoGenerateErp,
      erpNo: manualErpNo,
      partCode,
    } = req.body;

    await connection.beginTransaction();

    let erpNo;

    if (autoGenerateErp) {
      // Re-derive category name for the prefix, same scheme as create.
      const [categoryRows] = await connection.query(
        `SELECT name FROM categories WHERE id = ?`,
        [categoryId]
      );

      if (categoryRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ message: "Category not found" });
      }

      const categoryName = categoryRows[0].name;
      const prefix = categoryName
        .replace(/[^a-zA-Z]/g, "")
        .substring(0, 2)
        .toUpperCase();

      if (prefix.length < 2) {
        await connection.rollback();
        return res.status(400).json({
          message: "Category name must contain at least 2 letters",
        });
      }

      const now = new Date();
      const year = now.getFullYear().toString().slice(-2);
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const codePrefix = `${prefix}${year}${month}`;

      const [rows] = await connection.query(
        `
        SELECT erp_no
        FROM products
        WHERE category_id = ?
          AND erp_no LIKE ?
        ORDER BY CAST(SUBSTRING(erp_no, 7) AS UNSIGNED) DESC
        LIMIT 1
        FOR UPDATE
        `,
        [categoryId, `${codePrefix}%`]
      );

      let nextNumber = 1;
      if (rows.length > 0) {
        nextNumber = parseInt(rows[0].erp_no.substring(6), 10) + 1;
      }

      erpNo = `${codePrefix}${String(nextNumber).padStart(4, "0")}`;
    } else if (manualErpNo?.trim()) {
      erpNo = manualErpNo.trim().toUpperCase();

      // Lock and check uniqueness, excluding this product's own row.
      const [existing] = await connection.query(
        `SELECT id FROM products WHERE erp_no = ? AND id != ? FOR UPDATE`,
        [erpNo, id]
      );

      if (existing.length > 0) {
        await connection.rollback();
        return res.status(409).json({
          message: "ERP code already exists",
        });
      }
    }
    // If autoGenerateErp is false and no manualErpNo was sent, erpNo stays
    // undefined and the existing erp_no is left untouched below.

    const [result] = await connection.query(
      erpNo
        ? `UPDATE products
           SET category_id = ?, name = ?, description = ?, remarks = ?, erp_no = ?, part_code = ?
           WHERE id = ?`
        : `UPDATE products
           SET category_id = ?, name = ?, description = ?, remarks = ?
           WHERE id = ?`,
      erpNo
        ? [categoryId, name, description, remarks, erpNo, partCode, id]
        : [categoryId, name, description, remarks, partCode, id]
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Product not found" });
    }

    await connection.commit();

    return res.status(200).json({
      message: "Product updated successfully",
      erpNo,
      partCode,
    });
  } catch (error) {
    await connection.rollback();

    console.error("ERR IN UPDATE PRODUCT:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "ERP code already exists",
      });
    }

    return res.status(500).json({ message: error.message });
  } finally {
    connection.release();
  }
};

export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(`DELETE FROM products WHERE id = ?`, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    return res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    console.log("ERR IN DELETE PRODUCT:", error);
    return res.status(500).json({ message: error.message });
  }

};

export const getProducts = async (req, res) => {
  try {
    const [userRows] = await pool.query(
      `
      SELECT
        factory_id,
        line_id,
        stage_id,
        role
      FROM users
      WHERE id = ?
        AND is_active = 1
      `,
      [req?.user?.id]
    );

    if (!userRows.length) {
      return res.status(404).json({ message: "User not found" });
    }

    const {
      factory_id: factoryId,
      line_id: lineId,
      stage_id: stageId,
      role: userRole,
    } = userRows[0];


    if (!factoryId) {
      return res.status(400).json({
        message: "User is not assigned to a factory",
      });
    }

    const isPrivilegedUser = ["SYSTEM_ADMIN", "ADMIN"].includes(userRole);

    if (!isPrivilegedUser && !lineId) {
      return res.status(400).json({
        message: "User is not assigned to a production line",
      });
    }

    // ============================================================
    // Get products with a currently RUNNING production order for
    // this factory, plus how many items have SUCCESS scans at the
    // logged-in user's own stage for that order (achieved_qty).
    // GROUP BY p.id / MAX(po.id) collapses to one row per product
    // even if more than one RUNNING order exists for it.
    // ============================================================
    const [rows] = await pool.query(
      `
      SELECT
        p.id,
        p.name,
        p.erp_no,
        p.part_code,
        p.description,

        po.id AS production_order_id,
        po.order_no AS production_order_no,
        po.factory_id,
        po.line_id,
        pl.name AS line_name,
        po.target_qty,
        po.serial_prefix,
        po.serial_start,
        po.serial_end,
        po.serial_width,
        po.sequence_mode,
        po.status AS production_order_status,
        po.planned_date,

        COALESCE(sh.achieved_qty, 0) AS achieved_qty

      FROM production_orders po

      INNER JOIN products p
        ON p.id = po.product_id

      LEFT JOIN production_lines pl
        ON pl.id = po.line_id

      INNER JOIN (
        SELECT product_id, MAX(id) AS latest_id
        FROM production_orders
        WHERE factory_id = ?
          AND status = 'RUNNING'
        GROUP BY product_id
      ) latest
        ON latest.latest_id = po.id

      LEFT JOIN (
        SELECT
          production_order_id,
          COUNT(DISTINCT scanned_value) AS achieved_qty
        FROM scan_history
        WHERE stage_id = ?
          AND status = 'SUCCESS'
        GROUP BY production_order_id
      ) sh
        ON sh.production_order_id = po.id

      WHERE p.is_active = 1

      ORDER BY po.id DESC
      `,
      [factoryId, stageId]
    );

    // Derive remaining/percent per row now that we have target + achieved.
    const data = rows.map((row) => {
      const targetQty = Number(row.target_qty || 0);
      const achievedQty = Number(row.achieved_qty || 0);
      const remainingQty = Math.max(targetQty - achievedQty, 0);
      const achievementPercent =
        targetQty > 0 ? Number(((achievedQty / targetQty) * 100).toFixed(1)) : 0;

      return {
        ...row,
        achieved_qty: achievedQty,
        remaining_qty: remainingQty,
        achievement_percent: achievementPercent,
      };
    });

    return res.status(200).json({
      message: "Products fetched successfully",
      data,
      context: {
        factoryId,
        lineId,
        stageId,
      },
    });
  } catch (error) {
    console.error("ERR IN GET PRODUCTS:", error);
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getConfigurableProducts = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT
        id,
        name,
        erp_no,
        part_code,
        description
      FROM products
      WHERE is_active = 1
      ORDER BY id DESC
      `
    );

    return res.status(200).json({
      message: "Configurable products fetched successfully",
      data: rows,
    });
  } catch (error) {
    console.error("ERR IN GET CONFIGURABLE PRODUCTS:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};
export const getProductsForAdmin = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        id,
        category_id,
        name,
        erp_no,
        part_code,
        description,
        remarks,
        is_active,
        created_at
      FROM products
      WHERE is_active = 1
      ORDER BY id DESC
    `);

    return res.status(200).json({
      message: "Products fetched successfully",
      data: rows,
    });

  } catch (error) {
    console.error("ERR IN GET PRODUCTS FOR ADMIN:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};


export const getProductsByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;

    if (!categoryId) {
      return res.status(400).json({ success: false, message: "categoryId is required" });
    }

    const [rows] = await pool.query(
      `SELECT id, category_id, name, description, erp_no, part_code
       FROM products
       WHERE category_id = ? AND is_active = 1
       ORDER BY name ASC`,
      [categoryId]
    );

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.log("ERR IN GET PRODUCTS BY CATEGORY:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

