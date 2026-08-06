import {pool} from "../DB/config/mysql.config.js";

// Get All
export const getAllExternalSources = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM external_sources ORDER BY id DESC"
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get By ID
export const getExternalSourceById = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM external_sources WHERE id = ?",
      [req.params.id]
    );

    if (!rows.length)
      return res.status(404).json({ message: "Source not found" });

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Create
export const createExternalSource = async (req, res) => {
  try {
    const { code, name, description, is_active = true } = req.body;

    const [result] = await pool.query(
      `INSERT INTO external_sources
      (code,name,description,is_active)
      VALUES (?,?,?,?)`,
      [code, name, description, is_active]
    );

    res.status(201).json({
      message: "External Source Created",
      id: result.insertId,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Update
export const updateExternalSource = async (req, res) => {
  try {
    const { code, name, description, is_active } = req.body;

    await pool.query(
      `UPDATE external_sources
      SET code=?,name=?,description=?,is_active=?
      WHERE id=?`,
      [code, name, description, is_active, req.params.id]
    );

    res.json({ message: "Updated Successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Delete
export const deleteExternalSource = async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM external_sources WHERE id=?",
      [req.params.id]
    );

    res.json({ message: "Deleted Successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};



// GET /product-stage-flow/machine/:machineCode
// Read-only lookup used by external sources to identify which stage/machine
// they should report results for. No create/update/delete here.
export const getMachineByCode = async (req, res) => {
  try {
    const { machineCode } = req.params;

    if (!machineCode) {
      return res.status(400).json({ message: "Machine Code is required" });
    }

    const [rows] = await pool.query(
      `
      SELECT
          psf.machine_code,
          psf.external_source_type,
          psf.external_source,
          psf.external_machine_type,
          psf.external_folder_path,
          psf.external_poll_interval_minutes,
          psf.external_file_extensions,
          psf.external_api_config,
          pl.code AS line_code,
          s.name AS stage_name,
          s.line_id AS stage_line_id
      FROM product_stage_flow psf
      LEFT JOIN stages s
          ON s.id = psf.stage_id
      LEFT JOIN production_lines pl
          ON pl.id = s.line_id
      WHERE psf.machine_code = ?
      LIMIT 1;
      `,
      [machineCode]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Machine not found" });
    }

    const row = rows[0];

    return res.status(200).json({
      success: true,
      message: "Machine configuration fetched successfully.",
      data: {
        machineCode: row.machine_code,
        machineName: row.external_source,
        machineType: row.external_machine_type,

        lineCode: row.line_code,
        stageName: row.stage_name,
        stationCode: null,

        sourceType: row.external_source_type,
        watchFolder: row.external_folder_path,
        pollInterval: row.external_poll_interval_minutes,
        fileExtensions: row.external_file_extensions,
        apiConfig: row.external_api_config
      }
    });
  } catch (error) {
    console.log("ERR IN GET MACHINE BY CODE:", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};