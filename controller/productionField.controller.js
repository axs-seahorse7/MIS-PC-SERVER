import {pool} from "../DB/config/mysql.config.js";

export const createProductField = async (req, res) => {
  try {
    const {
      product_id,
      field_name,
      field_type = "TEXT",
      is_required = 0,
      is_unique = 0,
      is_scannable = 0,
      display_order = 1,
    } = req.body;

    const [result] = await pool.query(
      `
      INSERT INTO product_fields
      (
        product_id,
        field_name,
        field_type,
        is_required,
        is_unique,
        is_scannable,
        display_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        product_id,
        field_name,
        field_type,
        is_required,
        is_unique,
        is_scannable,
        display_order,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Field created successfully",
      id: result.insertId,
    });
  } catch (error) {
    console.log("ERR IN CREATE PRODUCT FIELD:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getProductFields = async (req, res) => {
  try {
    const [result] = await pool.query(`
      SELECT
        pf.*,
        p.name AS product_name
      FROM product_fields pf
      JOIN products p
        ON p.id = pf.product_id
      ORDER BY
        pf.product_id,
        pf.display_order
    `);

    return res.status(200).json(result);
  } catch (error) {
    console.log("ERR IN GET PRODUCT FIELDS:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getProductFieldsByProduct = async (
  req,
  res
) => {
  try {
    const { productId } = req.params;

    const [result] = await pool.query(
      `
      SELECT *
      FROM product_fields
      WHERE product_id = ?
      AND is_active = 1
      ORDER BY display_order
      `,
      [productId]
    );

    return res.status(200).json(result);
  } catch (error) {
    console.log("ERR IN GET PRODUCT FIELDS:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getProductFieldById = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      `
      SELECT *
      FROM product_fields
      WHERE id = ?
      `,
      [id]
    );

    if (result.length === 0) {
      return res.status(404).json({
        message: "Field not found",
      });
    }

    return res.status(200).json(result[0]);
  } catch (error) {
    console.log("ERR IN GET FIELD:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const updateProductField = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    const {
      field_name,
      field_type,
      is_required,
      is_unique,
      is_scannable,
      display_order,
      is_active,
    } = req.body;

    const [result] = await pool.query(
      `
      UPDATE product_fields
      SET
        field_name = ?,
        field_type = ?,
        is_required = ?,
        is_unique = ?,
        is_scannable = ?,
        display_order = ?,
        is_active = ?
      WHERE id = ?
      `,
      [
        field_name,
        field_type,
        is_required,
        is_unique,
        is_scannable,
        display_order,
        is_active,
        id,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Field not found",
      });
    }

    return res.status(200).json({
      message: "Field updated successfully",
    });
  } catch (error) {
    console.log("ERR IN UPDATE FIELD:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const deleteProductField = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      `
      UPDATE product_fields
      SET is_active = 0
      WHERE id = ?
      `,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Field not found",
      });
    }

    return res.status(200).json({
      message: "Field deleted successfully",
    });
  } catch (error) {
    console.log("ERR IN DELETE FIELD:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};