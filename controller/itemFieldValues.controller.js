import {pool} from "../DB/config/mysql.config.js";

export const createItemFieldValue = async (req, res) => {
  try {
    const {
      item_id,
      product_field_id,
      value,
    } = req.body;

    const [result] = await pool.query(
      `
      INSERT INTO item_field_values
      (
        item_id,
        product_field_id,
        value
      )
      VALUES (?, ?, ?)
      `,
      [
        item_id,
        product_field_id,
        value,
      ]
    );

    return res.status(201).json({
      message: "Field value added successfully",
      id: result.insertId,
    });
  } catch (error) {
    console.log(
      "ERR IN CREATE ITEM FIELD VALUE:",
      error
    );

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        message:
          "Value already exists for this field.",
      });
    }

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getItemFieldValues = async (
  req,
  res
) => {
  try {
    const [result] = await pool.query(`
      SELECT
        ifv.id,
        ifv.item_id,
        ifv.product_field_id,
        pf.field_name,
        ifv.value,
        ifv.created_at
      FROM item_field_values ifv
      JOIN product_fields pf
        ON pf.id = ifv.product_field_id
      ORDER BY ifv.item_id
    `);

    return res.status(200).json(result);
  } catch (error) {
    console.log(
      "ERR IN GET ITEM FIELD VALUES:",
      error
    );

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getItemFieldValuesByItem = async (
  req,
  res
) => {
  try {
    const { itemId } = req.params;

    const [result] = await pool.query(
      `
      SELECT
        ifv.id,
        ifv.product_field_id,
        pf.field_name,
        pf.field_type,
        ifv.value
      FROM item_field_values ifv
      JOIN product_fields pf
        ON pf.id = ifv.product_field_id
      WHERE ifv.item_id = ?
      ORDER BY pf.display_order
      `,
      [itemId]
    );

    return res.status(200).json(result);
  } catch (error) {
    console.log(
      "ERR IN GET ITEM VALUES:",
      error
    );

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const updateItemFieldValue = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { value } = req.body;

    const [result] = await pool.query(
      `
      UPDATE item_field_values
      SET value = ?
      WHERE id = ?
      `,
      [value, id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        message: "Record not found",
      });
    }

    return res.status(200).json({
      message: "Updated successfully",
    });
  } catch (error) {
    console.log(
      "ERR IN UPDATE ITEM VALUE:",
      error
    );

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const deleteItemFieldValue = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      `
      DELETE FROM item_field_values
      WHERE id = ?
      `,
      [id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        message: "Record not found",
      });
    }

    return res.status(200).json({
      message: "Deleted successfully",
    });
  } catch (error) {
    console.log(
      "ERR IN DELETE ITEM VALUE:",
      error
    );

    return res.status(500).json({
      message: error.message,
    });
  }
};