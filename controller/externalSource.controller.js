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
    const machineCode = req.params.machineCode?.trim();

    if (!machineCode) {
      return res.status(400).json({
        success: false,
        message: "Machine Code is required"
      });
    }

    // 1. Resolve machine -> stage -> line (machine_code is globally unique)
    const [stageRows] = await pool.query(
      `
      SELECT
          s.id AS stage_id,
          s.name AS stage_name,
          s.machine_code,
          s.is_active,
          s.line_id,
          pl.code AS line_code
      FROM stages s
      LEFT JOIN production_lines pl
          ON pl.id = s.line_id
      WHERE s.machine_code = ?
      LIMIT 1;
      `,
      [machineCode]
    );

    if (!stageRows.length) {
      return res.status(404).json({
        success: false,
        message: "Machine not found"
      });
    }

    const stage = stageRows[0];

    if (!stage.is_active) {
      return res.status(403).json({
        success: false,
        message: "Machine is linked to an inactive stage"
      });
    }

    // 2. Fetch external config for this stage (still stored on product_stage_flow)
    const [cfgRows] = await pool.query(
      `
      SELECT
          psf.external_source,
          psf.external_source_type,
          psf.external_machine_type,
          psf.external_folder_path,
          psf.external_poll_interval_minutes,
          psf.external_file_extensions,
          psf.external_api_config
      FROM product_stage_flow psf
      WHERE psf.stage_id = ?
        AND psf.is_external_dependency = 1
      ORDER BY psf.id ASC
      LIMIT 1;
      `,
      [stage.stage_id]
    );

    const cfg = cfgRows[0] || {};

    return res.status(200).json({
      success: true,
      message: "Machine configuration fetched successfully.",
      data: {
        machineCode: stage.machine_code,
        machineName: cfg.external_source ?? null,
        machineType: cfg.external_machine_type ?? null,

        lineId:     stage.line_id,
        lineCode:   stage.line_code,
        stageId:    stage.stage_id,
        stageName:  stage.stage_name,
        stationCode:null,

        sourceType: cfg.external_source_type ?? null,
        watchFolder: cfg.external_folder_path ?? null,
        pollInterval: cfg.external_poll_interval_minutes ?? null,
        fileExtensions: cfg.external_file_extensions ?? null,
        apiConfig: cfg.external_api_config ?? null
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