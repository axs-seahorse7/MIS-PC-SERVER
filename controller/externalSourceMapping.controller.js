import pool from "../DB/config/mysql.config.js";

// Get All Mappings
export const getAllExternalSourceMappings = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        esm.id,
        esm.source_id,
        es.code AS source_code,
        es.name AS source_name,

        esm.product_id,
        p.name AS product_name,

        esm.external_field,
        esm.mapping_type,
        esm.product_field_id,
        pf.field_name AS product_field_name,

        esm.attribute_name,
        esm.created_at

      FROM external_source_mappings esm

      INNER JOIN external_sources es
        ON esm.source_id = es.id

      INNER JOIN products p
        ON esm.product_id = p.id

      LEFT JOIN product_fields pf
        ON esm.product_field_id = pf.id

      ORDER BY esm.id DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Get By ID
export const getExternalSourceMappingById = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      `
      SELECT *
      FROM external_source_mappings
      WHERE id = ?
      `,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({
        message: "Mapping not found",
      });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Create Mapping
export const createExternalSourceMapping = async (req, res) => {
  try {
    const {
      source_id,
      product_id,
      external_field,
      mapping_type,
      product_field_id,
      attribute_name,
    } = req.body;

    const [result] = await pool.query(
      `
      INSERT INTO external_source_mappings
      (
        source_id,
        product_id,
        external_field,
        mapping_type,
        product_field_id,
        attribute_name
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        source_id,
        product_id,
        external_field,
        mapping_type,
        product_field_id || null,
        attribute_name || null,
      ]
    );

    res.status(201).json({
      message: "Mapping created successfully",
      id: result.insertId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Update Mapping
export const updateExternalSourceMapping = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      source_id,
      product_id,
      external_field,
      mapping_type,
      product_field_id,
      attribute_name,
    } = req.body;

    await pool.query(
      `
      UPDATE external_source_mappings
      SET
        source_id = ?,
        product_id = ?,
        external_field = ?,
        mapping_type = ?,
        product_field_id = ?,
        attribute_name = ?
      WHERE id = ?
      `,
      [
        source_id,
        product_id,
        external_field,
        mapping_type,
        product_field_id || null,
        attribute_name || null,
        id,
      ]
    );

    res.json({
      message: "Mapping updated successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Delete Mapping
export const deleteExternalSourceMapping = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      `
      DELETE FROM external_source_mappings
      WHERE id = ?
      `,
      [id]
    );

    res.json({
      message: "Mapping deleted successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};