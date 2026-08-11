import { pool } from "../DB/config/mysql.config.js";
import { processPackagingScan } from "../service/scan-history-services/processPackagingScan.servic.js";



// ---- shared sequence/duplicate validation, extracted from your original code ----
async function syncProduction(conn, {
    scanned_value,
    product_id,
    line_id,
    factory_id,
    stage_id,
    currentSeq,
    lastSequence
}) {

    // Check if production exists
    const [[production]] = await conn.query(
        `SELECT id
         FROM production
         WHERE serial_no = ?`,
        [scanned_value]
    );

    if (!production) {

        await conn.query(
            `INSERT INTO production (
                serial_no,
                product_id,
                factory_id,
                line_id,
                current_stage_id,
                current_sequence_no,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS')`,
            [
                scanned_value,
                product_id,
                factory_id,
                line_id,
                stage_id,
                currentSeq
            ]
        );

    } else {

        await conn.query(
            `UPDATE production
             SET
                current_stage_id = ?,
                current_sequence_no = ?,
                updated_at = NOW()
             WHERE serial_no = ?`,
            [
                stage_id,
                currentSeq,
                scanned_value
            ]
        );

    }

    // Last stage reached
    if (currentSeq === lastSequence) {

        await conn.query(
            `UPDATE production
             SET
                status='COMPLETED',
                completed_at = NOW(),
                updated_at = NOW()
             WHERE serial_no = ?`,
            [scanned_value]
        );

    }

}

const validateScanSequence = async (
  conn, {scanned_value, stage_id, product_id, currentSeq}) => {
    // last successful stage
    const [lastScanRows] = await conn.query(
        `SELECT MAX(sequence_no) AS lastSeq
         FROM scan_history
         WHERE scanned_value = ?
           AND status = 'SUCCESS'`,
        [scanned_value]
    );

    const lastSeq = lastScanRows[0].lastSeq || 0;

    // duplicate
    const [duplicate] = await conn.query(
        `SELECT id
         FROM scan_history
         WHERE scanned_value = ?
           AND stage_id = ?
           AND status = 'SUCCESS'
         LIMIT 1`,
        [scanned_value, stage_id]
    );

    if (duplicate.length) {
        return {
            ok: false,
            errorType: "DUPLICATE_STAGE",
            message: `"${scanned_value}" is already scanned at this stage.`,
        };
    }

    if (currentSeq === lastSeq) {
        return {
            ok: false,
            errorType: "ALREADY_COMPLETED",
            message: `"${scanned_value}": this stage is already completed for this item.`,
        };
    }

    if (currentSeq < lastSeq) {
        return {
            ok: false,
            errorType: "BACKWARD_SCAN",
            message: `"${scanned_value}": backward scan not allowed, item already progressed past this stage.`,
        };
    }

    if (currentSeq > lastSeq + 1) {
        const [missingFlow] = await conn.query(
            `SELECT psf.sequence_no, s.name AS stage_name
             FROM product_stage_flow psf
             JOIN stages s ON s.id = psf.stage_id
             WHERE psf.product_id = ?
               AND psf.sequence_no BETWEEN ? AND ?
             ORDER BY psf.sequence_no ASC`,
            [product_id, lastSeq + 1, currentSeq - 1]
        );

        return {
            ok: false,
            errorType: "MISSING_STAGES",
            missing: missingFlow.map(f => ({
                sequence_no: f.sequence_no,
                stage_name: f.stage_name
            })),
            message: `"${scanned_value}": missing stage(s) ${missingFlow.map(f => f.stage_name).join(", ")} must be scanned first.`,
        };
    }

    return { ok: true };
};

// ---- SINGLE ----
const handleSingleScan = async (conn, res, ctx) => {

    const {
        factory_id,
        line_id,
        stage_id,
        userId,
        scanned_value,
        currentSeq,
        product_id,
        lastSequence,

        // Packaging
        packaging_config_id,
        box_size,
        printer_id,
        barcode_format,

    } = ctx;

    const isPackagingStage = !!packaging_config_id;

    await conn.beginTransaction();

    try {

        // --------------------------------------------------
        // 1. Save scan history
        // --------------------------------------------------

        const [result] = await conn.query(
            `
            INSERT INTO scan_history
            (
                factory_id,
                line_id,
                stage_id,
                user_id,
                scanned_value,
                sequence_no,
                status,
                group_id
            )
            VALUES (?, ?, ?, ?, ?, ?, 'SUCCESS', NULL)
            `,
            [
                factory_id,
                line_id,
                stage_id,
                userId,
                scanned_value,
                currentSeq
            ]
        );


        // --------------------------------------------------
        // 2. Update PCB production
        // --------------------------------------------------

        await syncProduction(conn, {
            scanned_value,
            product_id,
            factory_id,
            line_id,
            stage_id,
            currentSeq,
            lastSequence
        });


        // --------------------------------------------------
        // 3. Packaging
        // --------------------------------------------------

        let packagingResult = null;

        if (isPackagingStage) {

            packagingResult = await processPackagingScan(conn, {
                product_id,
                stage_id,
                scanned_value,
                box_size,
                printer_id,
                barcode_format
            });
        }


        // --------------------------------------------------
        // 4. Commit
        // --------------------------------------------------

        await conn.commit();


        // --------------------------------------------------
        // 5. Response
        // --------------------------------------------------

        return res.status(201).json({

            success: true,

            message: "Scan recorded successfully.",

            data: {
                id: result.insertId,
                sequence_no: currentSeq,
                scan_mode: "SINGLE",
                pending_group: false,

                packaging: packagingResult
            }
        });


    } catch (error) {

        await conn.rollback();

        throw error;
    }
};

const checkExternalDependency = async (conn,
  {
    stage_name,
    external_source_type,
    external_machine_type,
    machine_code,
    scanned_value,
  }
) => {
  console.log(`Checking external dependency for ${stage_name}, ${machine_code}, ${scanned_value}...`);

  // Skip if this stage doesn't use a local machine result
  if (external_source_type !== "LOCAL_FILE") {
    return { ok: true };
  }


  // TODO:
  // Rename `ict_results` -> `machine_results`
  // This table will contain results from ALL machines.
  const [rows] = await conn.query(
    `SELECT result
     FROM ict_results
     WHERE machine_code = ? AND serial_no = ?
     ORDER BY imported_at DESC
     LIMIT 1`,
    [machine_code, scanned_value]
  );

  // No record found from the configured machine
  if (!rows.length) {
    return {
      ok: false,
      message: `${external_machine_type} scan required.`,
    };
  }

  // Machine processed the PCB but failed it
  if (rows[0].result !== "PASS") {
    return {
      ok: false,
      message: `${external_machine_type} FAILED.`,
    };
  }

  // Machine validation successful
  return { ok: true };
};

const checkProductStatus = async (conn, scanned_value) => {
    const [[product]] = await conn.query(
        `SELECT status
         FROM production
         WHERE serial_no = ?
         AND product_id IS NOT NULL LIMIT 1`,
        [scanned_value]
    );

    if (!product)
        return { ok: true };

    if (product.status === "REJECTED") {
        return {
            ok: false,
            errorType: "PRODUCT_REJECTED",
            message: "This PCB has already been rejected. Please use a new barcode after repair."
        };
    }

    if (product.status === "COMPLETED") {
        return {
            ok: false,
            errorType: "PRODUCT_COMPLETED",
            message: "This PCB has already completed production."
        };
    }

    return { ok: true };
};

// ---- GROUP_CREATE ----
const handleGroupCreate = async (conn, res, ctx) => {
  const {
    factory_id,
    line_id,
    stage_id,
    userId,
    scanned_value,
    currentSeq,
    product_id,
    lastSequence,
  } = ctx;

  await conn.beginTransaction();

  try {

    const [result] = await conn.query(
      `INSERT INTO scan_history
       (factory_id, line_id, stage_id, user_id, scanned_value, sequence_no, status, group_id)
       VALUES (?,?,?,?,?,?,'SUCCESS',NULL)`,
      [
        factory_id,
        line_id,
        stage_id,
        userId,
        scanned_value,
        currentSeq,
      ]
    );

    await syncProduction(conn, {
      scanned_value,
      product_id,
      factory_id,
      line_id,
      stage_id,
      currentSeq,
      lastSequence,
    });

    const [pending] = await conn.query(
      `SELECT id, scanned_value
       FROM scan_history
       WHERE stage_id = ?
         AND user_id = ?
         AND group_id IS NULL
         AND status = 'SUCCESS'
       ORDER BY scanned_at ASC`,
      [stage_id, userId]
    );

    await conn.commit();

    return res.status(201).json({
      success: true,
      message: "Scan recorded, pending group save.",
      data: {
        id: result.insertId,
        sequence_no: currentSeq,
        scan_mode: "GROUP_CREATE",
        pending_group: true,
        pending_items: pending,
      },
    });

  } catch (error) {

    await conn.rollback();
    throw error;

  }
};

// ---- GROUP_SCAN ----
const handleGroupScan = async (conn, res, ctx) => {
  const { factory_id, line_id, stage_id, userId, scanned_value: code, product_id, currentSeq, lastSequence } = ctx;

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

  // ===== START TRANSACTION HERE =====
  await conn.beginTransaction();

  try {

    const insertedIds = [];

    for (const m of members) {

      const [result] = await conn.query(
        `INSERT INTO scan_history
        (factory_id, line_id, stage_id, user_id, scanned_value, sequence_no, status, group_id)
        VALUES (?,?,?,?,?,?,'SUCCESS',?)`,
        [
          factory_id,
          line_id,
          stage_id,
          userId,
          m.scanned_value,
          currentSeq,
          groupId
        ]
      );

      await syncProduction(conn, {
        scanned_value: m.scanned_value,
        product_id,
        factory_id,
        line_id,
        stage_id,
        currentSeq,
        lastSequence
      });

      insertedIds.push(result.insertId);
    }

    // Everything succeeded
    await conn.commit();

    return res.status(201).json({
      success: true,
      message: "Group scan recorded successfully.",
      data: {
        group_id: groupId,
        sequence_no: currentSeq,
        scan_mode: "GROUP_SCAN",
        items_advanced: insertedIds.length,
      },
    });

  } catch (error) {

    // Undo ALL inserts and updates
    await conn.rollback();

    throw error;
  }
};

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

    const productStatus = await checkProductStatus(conn, scanned_value);

    if (!productStatus.ok) {
        return res.status(400).json(productStatus);
    }

    // joined with stages so we know the stage NAME (e.g. "ICT"), needed to
    // pick the right external-results table.
    const [flowRows] = await conn.query(
      `
      SELECT
          psf.id,
          psf.sequence_no,
          psf.scan_mode,
          psf.is_external_dependency,
          psf.external_source,
          psf.external_source_type,
          psf.external_machine_type,
          psf.machine_code,

          s.name AS stage_name,

          /* Packaging configuration */
          pc.id AS packaging_config_id,
          pc.box_size,
          pc.printer_id,
          pc.barcode_format,

          (
              SELECT MAX(sequence_no)
              FROM product_stage_flow
              WHERE product_id = psf.product_id
          ) AS last_sequence

      FROM product_stage_flow psf

      JOIN stages s
          ON s.id = psf.stage_id

      LEFT JOIN packaging_config pc
          ON pc.product_id = psf.product_id
          AND pc.stage_id = psf.stage_id
          AND pc.is_active = 1

      WHERE psf.product_id = ?
        AND psf.stage_id = ?;
      `,
      [product_id, stage_id]
    );



    if (!flowRows.length) {
      return res.status(400).json({ success: false, message: "This stage is not part of the product's flow" });
    }

    const {
      sequence_no: currentSeq,
      last_sequence: lastSequence,

      scan_mode,

      is_external_dependency,
      external_source,
      external_source_type,
      external_machine_type,
      machine_code,

      stage_name,

      // Packaging
      packaging_config_id,
      box_size,
      printer_id,
      barcode_format,
    } = flowRows[0];


    const ctx = {
      factory_id,
      line_id,
      stage_id,
      userId,
      scanned_value,
      product_id,

      currentSeq,
      lastSequence,

      // Packaging
      packaging_config_id,
      box_size,
      printer_id,
      barcode_format
    };


    // GROUP_SCAN validates per-member inside handleGroupScan, not here.
    if (scan_mode !== "GROUP_SCAN") {
      const validation = await validateScanSequence(conn, { scanned_value, stage_id, product_id, currentSeq });
      if (!validation.ok) {
        return res.status(400).json({
          success: false,
          errorType: validation.errorType,
          missing: validation.missing ?? null,
          message: validation.message,
        });
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
        external_machine_type,
        machine_code,
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

    const uniqueValues = [...new Set(scanned_values.map(v => String(v).trim()).filter(Boolean))];

    if (uniqueValues.length !== scanned_values.length) {
      return res.status(400).json({
        success: false,
        message: "Duplicate codes found in the scanned batch."
      });
    }

    const [userRows] = await conn.query(
      `SELECT id, factory_id, line_id, stage_id
       FROM users
       WHERE id = ?`,
      [userId]
    );

    if (!userRows.length) {
      return res.status(401).json({
        success: false,
        message: "User not found"
      });
    }

    const { factory_id, line_id, stage_id } = userRows[0];

    if (!stage_id) {
      return res.status(400).json({
        success: false,
        message: "User is not assigned to a stage"
      });
    }

    const [flowRows] = await conn.query(
      `SELECT sequence_no, scan_mode
       FROM product_stage_flow
       WHERE product_id = ?
         AND stage_id = ?`,
      [product_id, stage_id]
    );

    if (!flowRows.length) {
      return res.status(400).json({
        success: false,
        message: "This stage is not part of the product's flow"
      });
    }

    const {
      sequence_no: currentSeq,
      scan_mode
    } = flowRows[0];

    if (scan_mode !== "GROUP_CREATE") {
      return res.status(400).json({
        success: false,
        message: "This stage does not use GROUP_CREATE mode"
      });
    }

    // Validate first
    for (const scanned_value of uniqueValues) {
      const check = await validateScanSequence(conn, {
        scanned_value,
        stage_id,
        product_id,
        currentSeq
      });

      if (!check.ok) {
        return res.status(400).json({
          success: false,
          message: check.message
        });
      }
    }

    // Start transaction only before writing
    await conn.beginTransaction();

    try {

      const group_code = `GRP-${stage_id}-${Date.now()}`;

      const [groupResult] = await conn.query(
        `INSERT INTO scan_groups
        (group_code, product_id, factory_id, line_id, stage_id, created_by)
        VALUES (?,?,?,?,?,?)`,
        [
          group_code,
          product_id,
          factory_id,
          line_id,
          stage_id,
          userId
        ]
      );

      const groupId = groupResult.insertId;

      const insertedIds = [];

      for (const scanned_value of uniqueValues) {

        const [result] = await conn.query(
          `INSERT INTO scan_history
          (factory_id, line_id, stage_id, user_id, scanned_value, sequence_no, status, group_id)
          VALUES (?,?,?,?,?,?,'SUCCESS',?)`,
          [
            factory_id,
            line_id,
            stage_id,
            userId,
            scanned_value,
            currentSeq,
            groupId
          ]
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

    } catch (err) {

      await conn.rollback();
      throw err;

    }

  } catch (error) {

    console.log("ERR IN CREATE GROUP:", error);

    return res.status(500).json({
      success: false,
      message: error.message
    });

  } finally {

    conn.release();

  }
};