import {pool} from "../DB/config/mysql.config.js";

// Machine POST
export const receiveExternalResult = async (req, res) => {
  try {
    const {
      source_id,
      identifier,
      result,
      payload = null,
    } = req.body;

    await pool.query(
      `INSERT INTO external_results
      (source_id,identifier,result,payload)
      VALUES (?,?,?,?)`,
      [
        source_id,
        identifier,
        result,
        JSON.stringify(payload),
      ]
    );

    res.status(201).json({
      message: "Result Saved Successfully",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Admin View
export const getExternalResults = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
      er.*,
      es.name source_name,
      es.code
      FROM external_results er
      JOIN external_sources es
      ON es.id=er.source_id
      ORDER BY er.received_at DESC
    `);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Scan Engine
export const getExternalResultByIdentifier = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `
      SELECT
      er.*,
      es.code
      FROM external_results er
      JOIN external_sources es
      ON es.id=er.source_id
      WHERE identifier=?
      ORDER BY received_at DESC
    `,
      [req.params.identifier]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};