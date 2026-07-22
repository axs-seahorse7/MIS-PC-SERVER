import { pool } from "../DB/config/mysql.config.js";



// ---- shared sequence/duplicate validation, extracted from your original code ----
const validateScanSequence = async (conn, { scanned_value, stage_id, product_id, currentSeq }) => {
  const [lastScanRows] = await conn.query(
    `SELECT MAX(sequence_no) AS lastSeq FROM scan_history WHERE scanned_value = ? AND status = 'SUCCESS'`,
    [scanned_value]
  );
  const lastSeq = lastScanRows[0].lastSeq || 0;

  const [duplicate] = await conn.query(
    `SELECT id FROM scan_history WHERE scanned_value = ? AND stage_id = ? AND status = 'SUCCESS' LIMIT 1`,
    [scanned_value, stage_id]
  );
  if (duplicate.length) {
    return { ok: false, message: `"${scanned_value}" is already scanned at this stage.` };
  }

  if (currentSeq === lastSeq) {
    return { ok: false, message: `"${scanned_value}": this stage is already completed for this item.` };
  }
  if (currentSeq < lastSeq) {
    return { ok: false, message: `"${scanned_value}": backward scan not allowed, item already progressed past this stage.` };
  }
  if (currentSeq > lastSeq + 1) {
    const [missingFlow] = await conn.query(
      `SELECT psf.sequence_no, s.name AS stage_name
       FROM product_stage_flow psf
       JOIN stages s ON s.id = psf.stage_id
       WHERE psf.product_id = ? AND psf.sequence_no BETWEEN ? AND ?
       ORDER BY psf.sequence_no ASC`,
      [product_id, lastSeq + 1, currentSeq - 1]
    );
    const missingNames = missingFlow.map((f) => f.stage_name).join(", ");
    return {
      ok: false,
      message: `"${scanned_value}": missing stage(s) ${missingNames || `sequence ${lastSeq + 1}`} must be scanned first.`,
    };
  }

  return { ok: true };
};

// ---- SINGLE ----
const handleSingleScan = async (conn, res, ctx) => {
  const { factory_id, line_id, stage_id, userId, scanned_value, currentSeq } = ctx;
  const [result] = await conn.query(
    `INSERT INTO scan_history (factory_id, line_id, stage_id, user_id, scanned_value, sequence_no, status, group_id)
     VALUES (?,?,?,?,?,?,'SUCCESS',NULL)`,
    [factory_id, line_id, stage_id, userId, scanned_value, currentSeq]
  );
  return res.status(201).json({
    success: true,
    message: "Scan recorded successfully.",
    data: { id: result.insertId, sequence_no: currentSeq, scan_mode: "SINGLE", pending_group: false },
  });
};


const checkExternalDependency = async (conn, { stage_name, external_source, external_source_type, scanned_value }) => {
  if (external_source_type !== "LOCAL_FILE") {
    // API-backed external sources aren't implemented yet — nothing to check against.
    return { ok: true };
  }
 
  const machineName = external_source; // configured per stage, e.g. "ICT-01"
 
  if (stage_name?.toUpperCase() === "ICT") {
    const [rows] = await conn.query(
      `SELECT result FROM ict_results
       WHERE machine_name = ? AND serial_no = ?
       ORDER BY imported_at DESC
       LIMIT 1`,
      [machineName, scanned_value]
    );
 
    if (!rows.length) {
      return { ok: false, message: "ICT scan required" };
    }
    if (rows[0].result !== "PASS") {
      return { ok: false, message: "ICT FAILED" };
    }
    return { ok: true };
  }
 
  console.warn(`No external-result table wired up for stage "${stage_name}" yet — skipping check.`);
  return { ok: true };
};


// ---- GROUP_CREATE ----
const handleGroupCreate = async (conn, res, ctx) => {
  const { factory_id, line_id, stage_id, userId, scanned_value, currentSeq } = ctx;
  const [result] = await conn.query(
    `INSERT INTO scan_history (factory_id, line_id, stage_id, user_id, scanned_value, sequence_no, status, group_id)
     VALUES (?,?,?,?,?,?,'SUCCESS',NULL)`,
    [factory_id, line_id, stage_id, userId, scanned_value, currentSeq]
  );

  const [pending] = await conn.query(
    `SELECT id, scanned_value FROM scan_history
     WHERE stage_id = ? AND user_id = ? AND group_id IS NULL AND status = 'SUCCESS'
     ORDER BY scanned_at ASC`,
    [stage_id, userId]
  );

  return res.status(201).json({
    success: true,
    message: "Scan recorded, pending group save.",
    data: {
      id: result.insertId,
      sequence_no: currentSeq,
      scan_mode: "GROUP_CREATE",
      pending_group: true,
      pending_items: pending, // frontend renders this list + a "Save Group" button
    },
  });
};

// ---- GROUP_SCAN ----
const handleGroupScan = async (conn, res, ctx) => {
  const { factory_id, line_id, stage_id, userId, scanned_value: code, product_id, currentSeq } = ctx;

  // Find this item's most recent SUCCESSFUL scan — i.e. the last stage it
  // actually completed. Ordering by sequence_no (then scanned_at as a
  // tiebreaker) is required here; without it MySQL can return ANY matching
  // row for this scanned_value, since the item has one row per stage.
  const [lastRows] = await conn.query(
    `SELECT group_id, sequence_no
     FROM scan_history
     WHERE scanned_value = ? AND status = 'SUCCESS'
     ORDER BY sequence_no DESC, scanned_at DESC
     LIMIT 1`,
    [code]
  );

  if (!lastRows.length) {
    return res.status(400).json({
      success: false,
      message: "This item not Grouped yet. Please create a group first before scanning.",
    });
  }

  const { group_id: groupId, sequence_no: lastSeq } = lastRows[0];

  if (!groupId) {
    return res.status(400).json({
      success: false,
      message: "This item isn't part of a group yet — create the group first.",
    });
  }

  // The item's last completed stage must be EXACTLY one behind this stage.
  if (lastSeq !== currentSeq - 1) {
    return res.status(400).json({
      success: false,
      message:
        lastSeq >= currentSeq
          ? "This Item is already scanned at this stage or beyond."
          : "Previous stage not completed for this item.",
    });
  }

  const [groupRows] = await conn.query(
    `SELECT id, product_id FROM scan_groups WHERE id = ?`,
    [groupId]
  );

  if (!groupRows.length) {
    return res.status(400).json({ success: false, message: "Group record not found." });
  }

  if (groupRows[0].product_id !== product_id) {
    return res.status(400).json({ success: false, message: "Group does not belong to this product." });
  }

  const [members] = await conn.query(
    `SELECT DISTINCT scanned_value FROM scan_history WHERE group_id = ?`,
    [groupId]
  );
  if (!members.length) {
    return res.status(400).json({ success: false, message: "Group has no member items." });
  }

  // Validate every member individually too — catches any member that
  // somehow fell out of sync with the rest of the group (e.g. a manual
  // DB edit, or a partial failure in an earlier stage).
  for (const m of members) {
    const check = await validateScanSequence(conn, {
      scanned_value: m.scanned_value,
      stage_id,
      product_id,
      currentSeq,
    });
    if (!check.ok) {
      return res.status(400).json({ success: false, message: `Item ${m.scanned_value}: ${check.message}` });
    }
  }

  const insertedIds = [];
  for (const m of members) {
    const [result] = await conn.query(
      `INSERT INTO scan_history (factory_id, line_id, stage_id, user_id, scanned_value, sequence_no, status, group_id)
       VALUES (?,?,?,?,?,?,'SUCCESS',?)`,
      [factory_id, line_id, stage_id, userId, m.scanned_value, currentSeq, groupId]
    );
    insertedIds.push(result.insertId);
  }

  return res.status(201).json({
    success: true,
    message: "Group scan recorded successfully.",
    data: { group_id: groupId, sequence_no: currentSeq, scan_mode: "GROUP_SCAN", items_advanced: insertedIds.length },
  });
};

// ---- dispatcher ----
// export const submitScan = async (req, res) => {
//   const conn = await pool.getConnection();
//   try {
//     const { scanned_value, product_id } = req.body;
//     const userId = req?.user?.id;

//     if (!scanned_value) {
//       return res.status(400).json({ success: false, message: "Scanned code is required" });
//     }
//     if (!product_id) {
//       return res.status(400).json({ success: false, message: "product_id is required" });
//     }

//     const [userRows] = await conn.query(
//       `SELECT id, factory_id, line_id, stage_id FROM users WHERE id = ?`,
//       [userId]
//     );
//     if (!userRows.length) {
//       return res.status(401).json({ success: false, message: "User not found" });
//     }
//     const { factory_id, line_id, stage_id } = userRows[0];
//     if (!stage_id) {
//       return res.status(400).json({ success: false, message: "User is not assigned to a stage" });
//     }

//     // is_mandatory / group_required are gone. is_external_dependency and
//     // external_source are pulled through too, in case downstream logic
//     // needs to flag/display an external dependency later.
//     const [flowRows] = await conn.query(
//       `SELECT id, sequence_no, scan_mode, is_external_dependency, external_source
//        FROM product_stage_flow
//        WHERE product_id = ? AND stage_id = ?`,
//       [product_id, stage_id]
//     );

//     if (!flowRows.length) {
//       return res.status(400).json({ success: false, message: "This stage is not part of the product's flow" });
//     }

//     const { sequence_no: currentSeq, scan_mode, is_external_dependency, external_source } = flowRows[0];

//     const ctx = { factory_id, line_id, stage_id, userId, scanned_value, product_id, currentSeq };


//     if (scan_mode !== "GROUP_SCAN") {
//       const validation = await validateScanSequence(conn, { scanned_value, stage_id, product_id, currentSeq });
//       if (!validation.ok) {
//         return res.status(400).json({ success: false, message: validation.message });
//       }
//     }

//     switch (scan_mode) {
//       case "SINGLE":
//         return await handleSingleScan(conn, res, ctx);
//       case "GROUP_CREATE":
//         return await handleGroupCreate(conn, res, ctx);
//       case "GROUP_SCAN":
//         return await handleGroupScan(conn, res, ctx);
//       default:
//         return res.status(400).json({ success: false, message: "Invalid scan mode" });
//     }
//   } catch (error) {
//     console.log("ERR IN SUBMIT SCAN:", error);
//     return res.status(500).json({ success: false, message: error.message });
//   } finally {
//     conn.release();
//   }
// };


export const submitScan = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { scanned_value, product_id } = req.body;
    const userId = req?.user?.id;

    if (!scanned_value) {
      return res.status(400).json({ success: false, message: "Scanned code is required" });
    }
    if (!product_id) {
      return res.status(400).json({ success: false, message: "product_id is required" });
    }

    const [userRows] = await conn.query(
      `SELECT id, factory_id, line_id, stage_id FROM users WHERE id = ?`,
      [userId]
    );
    if (!userRows.length) {
      return res.status(401).json({ success: false, message: "User not found" });
    }
    const { factory_id, line_id, stage_id } = userRows[0];
    if (!stage_id) {
      return res.status(400).json({ success: false, message: "User is not assigned to a stage" });
    }

    // joined with stages so we know the stage NAME (e.g. "ICT"), needed to
    // pick the right external-results table.
    const [flowRows] = await conn.query(
      `SELECT psf.id, psf.sequence_no, psf.scan_mode, psf.is_external_dependency,
              psf.external_source, psf.external_source_type, s.name AS stage_name
       FROM product_stage_flow psf
       JOIN stages s ON s.id = psf.stage_id
       WHERE psf.product_id = ? AND psf.stage_id = ?`,
      [product_id, stage_id]
    );
    if (!flowRows.length) {
      return res.status(400).json({ success: false, message: "This stage is not part of the product's flow" });
    }
    const {
      sequence_no: currentSeq,
      scan_mode,
      is_external_dependency,
      external_source,
      external_source_type,
      stage_name,
    } = flowRows[0];

    const ctx = { factory_id, line_id, stage_id, userId, scanned_value, product_id, currentSeq };

    // GROUP_SCAN validates per-member inside handleGroupScan, not here.
    if (scan_mode !== "GROUP_SCAN") {
      const validation = await validateScanSequence(conn, { scanned_value, stage_id, product_id, currentSeq });
      if (!validation.ok) {
        return res.status(400).json({ success: false, message: validation.message });
      }
    }

    // External dependency gate — SINGLE mode only for now (e.g. ICT/FCT
    // gating before Packing). GROUP_CREATE/GROUP_SCAN aren't wired up yet;
    // extend this condition when those need the same check.
    if (scan_mode === "SINGLE" && is_external_dependency) {
      const depCheck = await checkExternalDependency(conn, {
        stage_name,
        external_source,
        external_source_type,
        scanned_value,
      });
      if (!depCheck.ok) {
        return res.status(400).json({ success: false, message: depCheck.message });
      }
    }

    switch (scan_mode) {
      case "SINGLE":
        return await handleSingleScan(conn, res, ctx);
      case "GROUP_CREATE":
        return await handleGroupCreate(conn, res, ctx);
      case "GROUP_SCAN":
        return await handleGroupScan(conn, res, ctx);
      default:
        return res.status(400).json({ success: false, message: "Invalid scan mode" });
    }
  } catch (error) {
    console.log("ERR IN SUBMIT SCAN:", error);
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    conn.release();
  }
};


// ---- POST /scan-history/create-group ----
export const createGroup = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { scanned_values, product_id } = req.body;
    const userId = req?.user?.id;

    if (!Array.isArray(scanned_values) || !scanned_values.length) {
      return res.status(400).json({ success: false, message: "scanned_values array is required" });
    }
    if (!product_id) {
      return res.status(400).json({ success: false, message: "product_id is required" });
    }

    // reject obvious client-side dupes before touching the DB
    const uniqueValues = [...new Set(scanned_values.map((v) => String(v).trim()).filter(Boolean))];
    if (uniqueValues.length !== scanned_values.length) {
      return res.status(400).json({ success: false, message: "Duplicate codes found in the scanned batch." });
    }

    const [userRows] = await conn.query(
      `SELECT id, factory_id, line_id, stage_id FROM users WHERE id = ?`,
      [userId]
    );
    if (!userRows.length) {
      return res.status(401).json({ success: false, message: "User not found" });
    }
    const { factory_id, line_id, stage_id } = userRows[0];
    if (!stage_id) {
      return res.status(400).json({ success: false, message: "User is not assigned to a stage" });
    }

    const [flowRows] = await conn.query(
      `SELECT sequence_no, scan_mode FROM product_stage_flow WHERE product_id = ? AND stage_id = ?`,
      [product_id, stage_id]
    );
    if (!flowRows.length) {
      return res.status(400).json({ success: false, message: "This stage is not part of the product's flow" });
    }
    const { sequence_no: currentSeq, scan_mode } = flowRows[0];
    if (scan_mode !== "GROUP_CREATE") {
      return res.status(400).json({ success: false, message: "This stage does not use GROUP_CREATE mode" });
    }

    await conn.beginTransaction();

    // validate every code before inserting anything
    for (const scanned_value of uniqueValues) {
      const check = await validateScanSequence(conn, { scanned_value, stage_id, product_id, currentSeq });
      if (!check.ok) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: check.message });
      }
    }

    const group_code = `GRP-${stage_id}-${Date.now()}`;
    const [groupResult] = await conn.query(
      `INSERT INTO scan_groups (group_code, product_id, factory_id, line_id, stage_id, created_by)
       VALUES (?,?,?,?,?,?)`,
      [group_code, product_id, factory_id, line_id, stage_id, userId]
    );
    const groupId = groupResult.insertId;

    const insertedIds = [];
    for (const scanned_value of uniqueValues) {
      const [result] = await conn.query(
        `INSERT INTO scan_history
         (factory_id, line_id, stage_id, user_id, scanned_value, sequence_no, status, group_id)
         VALUES (?,?,?,?,?,?,'SUCCESS',?)`,
        [factory_id, line_id, stage_id, userId, scanned_value, currentSeq, groupId]
      );
      insertedIds.push(result.insertId);
    }

    await conn.commit();

    return res.status(201).json({
      success: true,
      message: "Group created successfully.",
      data: {
        group_id: groupId,
        group_code,
        sequence_no: currentSeq,
        item_count: insertedIds.length,
        scan_history_ids: insertedIds,
      },
    });
  } catch (error) {
    await conn.rollback();
    console.log("ERR IN CREATE GROUP:", error);
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    conn.release();
  }
};
