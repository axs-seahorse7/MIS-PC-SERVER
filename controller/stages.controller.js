import {pool} from "../DB/config/mysql.config.js"

const httpError = (status, message) =>
  Object.assign(new Error(message), { status });

// "ict " -> "ICT". Returns null when not provided, throws on invalid values.
const normalizeMachineType = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const type = String(value).trim().toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(type)) {
    throw httpError(400, "Machine type must be 1-20 letters/numbers (e.g. ICT, FCT, HIPOT)");
  }
  return type;
};

// Next code for a machine type across ALL stages, e.g. ICT -> ICT-0003.
const generateMachineCode = async (machineType) => {
  const [rows] = await pool.query(
    `SELECT machine_code FROM stages
     WHERE machine_code LIKE ?
     ORDER BY CAST(SUBSTRING_INDEX(machine_code, '-', -1) AS UNSIGNED) DESC
     LIMIT 1`,
    [`${machineType}-%`]
  );

  let nextNum = 1;
  if (rows.length) {
    const match = String(rows[0].machine_code).match(/(\d+)$/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  return `${machineType}-${String(nextNum).padStart(4, "0")}`;
};

// uq_stages_machine_code guards against two requests picking the same number:
// on a duplicate we regenerate and try again.
const runWithFreshMachineCode = async (machineType, fn) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = await generateMachineCode(machineType);
    try {
      return await fn(code);
    } catch (err) {
      if (err.code !== "ER_DUP_ENTRY") throw err;
    }
  }
  throw httpError(409, "Could not generate a unique machine code, please retry");
};

const STAGE_SELECT = `
  SELECT
    s.id,
    s.category_id,
    c.name AS category_name,
    s.factory_id,
    f.name AS factory_name,
    s.line_id,
    pl.name AS line_name,
    pl.code AS line_code,
    s.name,
    s.machine_code,
    SUBSTRING_INDEX(s.machine_code, '-', 1) AS machine_type,
    s.description,
    s.is_active,
    s.created_at
  FROM stages s
  LEFT JOIN categories c ON c.id = s.category_id
  LEFT JOIN factories f ON f.id = s.factory_id
  LEFT JOIN production_lines pl ON pl.id = s.line_id
`;

export const createStage = async (req, res) => {
  try {
    const { name, categoryId, factoryId, lineId, description, machineType } = req.body;

    // Optional: send machineType (e.g. "ICT") to make this stage a machine.
    // Each such stage gets its own globally unique code (ICT-0001, ICT-0002...),
    // so two machines on one line = two stages. Products that use this stage
    // in their flow all share the same code.
    const type = normalizeMachineType(machineType);

    const insertStage = (code) =>
      pool.query(
        `INSERT INTO stages (name, machine_code, category_id, factory_id, line_id, description)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [name, code, categoryId, factoryId || null, lineId || null, description || null]
      );

    const [result] = type
      ? await runWithFreshMachineCode(type, insertStage)
      : await insertStage(null);

    const [rows] = await pool.query(`${STAGE_SELECT} WHERE s.id = ?`, [result.insertId]);

    return res.status(201).json({
      message: "Stage created successfully",
      id: result.insertId,
      machine_code: rows[0]?.machine_code ?? null,
    });
  } catch (error) {
    console.log("ERR IN CREATE STAGE:", error);
    return res.status(error.status || 500).json({ message: error.message });
  }
};


export const getStages = async (req, res) => { 
  try {
    const [stages] = await pool.query(`${STAGE_SELECT} ORDER BY s.id DESC`);
    return res.status(200).json(stages);
  } catch (error) {
    console.log("ERR IN GET STAGES:", error);
    return res.status(500).json({ message: error.message });
  }
};

export const getStageById = async (req, res) => {
  try {
    const { id } = req.params;

    const [stage] = await pool.query(`${STAGE_SELECT} WHERE s.id = ?`, [id]);

    if (stage.length === 0) {
      return res.status(404).json({ message: "Stage not found" });
    }

    return res.status(200).json(stage[0]);
  } catch (error) {
    console.log("ERR IN GET STAGE:", error);
    return res.status(500).json({ message: error.message });
  }
};

export const updateStage = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, categoryId, factoryId, lineId, description, is_active, machineType } = req.body;
    const type = normalizeMachineType(machineType);

    const [existingRows] = await pool.query(
      `SELECT machine_code FROM stages WHERE id = ?`,
      [id]
    );
    if (!existingRows.length) {
      return res.status(404).json({ message: "Stage not found" });
    }
    const existingCode = existingRows[0].machine_code;

    // A machine code is permanent once issued (the Machine Connector is
    // installed with it). It is only generated the first time a machine type
    // is given for a stage that has no code yet.
    if (existingCode && type && !existingCode.startsWith(`${type}-`)) {
      return res.status(409).json({
        message: `Stage already has machine code ${existingCode}; it cannot be changed`,
      });
    }

    const updateStageRow = (code) =>
      pool.query(
        `UPDATE stages
         SET name = ?, machine_code = ?, category_id = ?, factory_id = ?, line_id = ?, description = ?, is_active = ?
         WHERE id = ?`,
        [
          name,
          code,
          categoryId,
          factoryId || null,
          lineId || null,
          description || null,
          is_active === undefined ? 1 : is_active,
          id,
        ]
      );

    if (!existingCode && type) {
      await runWithFreshMachineCode(type, updateStageRow);
    } else {
      await updateStageRow(existingCode);
    }

    return res.status(200).json({ message: "Stage updated successfully" });
  } catch (error) {
    console.log("ERR IN UPDATE STAGE:", error);
    return res.status(error.status || 500).json({ message: error.message });
  }
};

export const deleteStage = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(`DELETE FROM stages WHERE id = ?`, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Stage not found" });
    }

    return res.status(200).json({ message: "Stage deleted successfully" });
  } catch (error) {
    console.log("ERR IN DELETE STAGE:", error);
    if (error.code === "ER_ROW_IS_REFERENCED_2" || error.code === "ER_ROW_IS_REFERENCED") {
      return res.status(409).json({ message: "Cannot delete: stage is in use" });
    }
    return res.status(500).json({ message: error.message });
  }
};