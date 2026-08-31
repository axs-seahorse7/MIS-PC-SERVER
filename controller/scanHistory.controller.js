import { pool } from "../DB/config/mysql.config.js";
import { processPackagingScan } from "../service/scan-history-services/processPackagingScan.servic.js";
import {validateProductionOrderSequence} from "../utils/productionOrderSequence.js";



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


//-------- validating stage sequence (this will ensure no any stage/station should be skipped on production line) -------
// Do not confuse with production order sequence validation wich is use to validate product srialise seuence, which is a separate check
const validateScanSequence = async (conn,{ scanned_value, stage_id, product_id, currentSeq }) => {

  // ============================================================
  // 1. Get last successful PHYSICAL MES stage
  // ============================================================

  const [lastScanRows] = await conn.query(
    `
    SELECT MAX(sequence_no) AS lastSeq
    FROM scan_history
    WHERE scanned_value = ?
      AND status = 'SUCCESS'
    `,
    [scanned_value]
  );

  const lastSeq = Number(lastScanRows[0]?.lastSeq || 0);


  // ============================================================
  // 2. Duplicate scan check
  // ============================================================

  const [duplicate] = await conn.query(
    `
    SELECT id
    FROM scan_history
    WHERE scanned_value = ?
      AND stage_id = ?
      AND status = 'SUCCESS'
    LIMIT 1
    `,
    [
      scanned_value,
      stage_id
    ]
  );

  if (duplicate.length) {
    return {
      ok: false,
      errorType: "DUPLICATE_STAGE",
      message: `"${scanned_value}" is already scanned at this stage.`,
    };
  }


  // ============================================================
  // 3. Backward / already completed validation
  // ============================================================

  if (currentSeq === lastSeq) {
    return {
      ok: false,
      errorType: "ALREADY_COMPLETED",
      message:
        `"${scanned_value}": this stage is already completed for this item.`,
    };
  }

  if (currentSeq < lastSeq) {
    return {
      ok: false,
      errorType: "BACKWARD_SCAN",
      message:
        `"${scanned_value}": backward scan not allowed, item already progressed past this stage.`,
    };
  }


  // ============================================================
  // 4. Check skipped stages
  // ============================================================

  if (currentSeq > lastSeq + 1) {
    const [skippedStages] = await conn.query(
      `
      SELECT
        psf.stage_id,
        psf.sequence_no,
        psf.is_external_dependency,
        psf.external_source_type,
        psf.external_machine_type,
        psf.machine_code,
        s.name AS stage_name

      FROM product_stage_flow psf

      JOIN stages s
        ON s.id = psf.stage_id

      WHERE psf.product_id = ?
        AND psf.sequence_no BETWEEN ? AND ?

      ORDER BY psf.sequence_no ASC
      `,
      [
        product_id,
        lastSeq + 1,
        currentSeq - 1,
      ]
    );


    // ----------------------------------------------------------
    // Separate normal stages from external dependencies
    // ----------------------------------------------------------

    const normalMissingStages = skippedStages.filter(stage => !stage.is_external_dependency);
    const externalDependencies = skippedStages.filter(stage => stage.is_external_dependency);


    // ==========================================================
    // 5. Normal MES stages cannot be skipped
    // ==========================================================

    if (normalMissingStages.length) {
      return {
        ok: false,
        errorType: "MISSING_STAGES",

        missing: normalMissingStages.map(stage => ({
          sequence_no: stage.sequence_no,
          stage_name: stage.stage_name,
        })),

        message:`"${scanned_value}": missing stage(s) ` + `${normalMissingStages.map(stage => stage.stage_name)
          .join(", ")} must be scanned first.`,
      };
    }


    // ==========================================================
    // 6. Validate skipped external dependencies
    // ==========================================================

    for (const dependency of externalDependencies) {

      const dependencyValidation =
        await checkExternalDependency(conn, {
          stage_name: dependency.stage_name,
          external_source_type: dependency.external_source_type,
          external_machine_type: dependency.external_machine_type,
          machine_code: dependency.machine_code,
          scanned_value,
        });


      if (!dependencyValidation.ok) {

        return {
          ok: false,

          errorType: "EXTERNAL_DEPENDENCY_FAILED",

          stage: {
            sequence_no: dependency.sequence_no,
            stage_name: dependency.stage_name,
            machine_type: dependency.external_machine_type,
            machine_code: dependency.machine_code,
          },

          message: dependencyValidation.message,
        };
      }
    }
  }


  // ============================================================
  // 7. All validations passed
  // ============================================================

  return {
    ok: true
  };
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

    packaging_config_id,
    box_size,
    printer_id,
    barcode_format,
    printer_name
  } = ctx;

  const isPackagingStage = !!packaging_config_id;

  await conn.beginTransaction();

  try {

    // ============================================================
    // 1. Production Order Validation
    // ============================================================

    const productionValidation =
      await validateProductionOrderSequence(conn, {
        factoryId: factory_id,
        productId: product_id,
        lineId: line_id,
        stageId: stage_id,
        scannedValue: scanned_value,
      });

    if (!productionValidation.ok) {

      console.log(
        "Production order validation failed:",
        productionValidation
      );

      await conn.rollback();

      return res.status(409).json({
        success: false,
        errorType: productionValidation.errorType,
        message: productionValidation.message,
        productionOrderId: productionValidation.productionOrderId ?? null,
        expectedSequence: productionValidation.expectedSequence ?? null,
        expectedSerial: productionValidation.expectedSerial ?? null,
        scannedSequence: productionValidation.scannedSequence ?? null,
        scannedSerial: productionValidation.scannedSerial ?? null,
      });
    }

    const {
      productionOrder,
      productionOrderItem,
      productionOrderStage,
    } = productionValidation;


    // ============================================================
    // 2. Save Scan History
    // ============================================================

    const [result] = await conn.query(
      `
      INSERT INTO scan_history
      (
        factory_id,
        line_id,
        stage_id,
        user_id,
        production_order_id,
        scanned_value,
        sequence_no,
        status,
        group_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'SUCCESS', NULL)
      `,
      [
        factory_id,
        line_id,
        stage_id,
        userId,
        productionOrder.id,
        scanned_value,
        currentSeq,
      ]
    );


    // ============================================================
    // 3. Update PCB Production State
    // ============================================================

    await syncProduction(conn, {
      scanned_value,
      product_id,
      factory_id,
      line_id,
      stage_id,
      currentSeq,
      lastSequence,
    });


    // ============================================================
    // 4. Production Achievement
    // ============================================================

    const [achievementRows] = await conn.query(
      `
      SELECT
        COUNT(DISTINCT sh.scanned_value) AS achieved_qty
      FROM scan_history sh
      WHERE sh.production_order_id = ?
        AND sh.stage_id = ?
        AND sh.status = 'SUCCESS'
      `,
      [
        productionOrder.id,
        stage_id,
      ]
    );

    const stageAchievedQty = Number(
      achievementRows[0]?.achieved_qty || 0
    );

    const targetQty = Number(productionOrder.target_qty || 0);

    const remainingQty = Math.max(
      targetQty - stageAchievedQty,
      0
    );

    const achievementPercent =
      targetQty > 0
        ? Number(
            ((stageAchievedQty / targetQty) * 100).toFixed(1)
          )
        : 0;


    // ============================================================
    // 5. Complete Production Order When Target Is Reached
    // ============================================================

    let productionCompleted = false;

    if (
      targetQty > 0 &&
      stageAchievedQty >= targetQty
    ) {

      await conn.query(
        `
        UPDATE production_orders
        SET
          status = 'COMPLETED',
          completed_at = NOW()
        WHERE id = ?
          AND status = 'RUNNING'
        `,
        [
          productionOrder.id,
        ]
      );

      productionCompleted = true;
    }


    // ============================================================
    // 6. Advance Production Order Stage
    // ============================================================

    let productionStageCompleted = false;
    let nextExpectedSequence = null;

    if (
      productionOrder.sequence_mode === "SEQUENTIAL" &&
      productionOrderStage
    ) {

      const currentExpected = Number(
        productionOrderStage.next_expected_sequence
      );

      const lastSequenceNumber = Number(
        productionOrder.serial_end
      );

      nextExpectedSequence = currentExpected + 1;

      if (currentExpected >= lastSequenceNumber) {

        await conn.query(
          `
          UPDATE production_order_stages
          SET
            next_expected_sequence = ?,
            status = 'COMPLETED'
          WHERE id = ?
          `,
          [
            nextExpectedSequence,
            productionOrderStage.id,
          ]
        );

        productionStageCompleted = true;

      } else {

        await conn.query(
          `
          UPDATE production_order_stages
          SET
            next_expected_sequence = ?
          WHERE id = ?
          `,
          [
            nextExpectedSequence,
            productionOrderStage.id,
          ]
        );
      }
    }


    // ============================================================
    // 7. Packaging
    // ============================================================

    let packagingResult = null;

    if (isPackagingStage) {

      packagingResult = await processPackagingScan(conn, {
        product_id,
        stage_id,
        scanned_value,
        box_size,
        printer_id,
        barcode_format,
        packaging_config_id,
        printer_name
      });
    }


    // ============================================================
    // 8. Commit
    // ============================================================

    await conn.commit();


    // ============================================================
    // 9. Response
    // ============================================================

    return res.status(201).json({
      success: true,

      message: productionCompleted
        ? "Scan recorded successfully. Production order completed."
        : "Scan recorded successfully.",

      data: {
        id: result.insertId,

        serial_no: scanned_value,
        sequence_no: currentSeq,

        scan_mode: "SINGLE",
        pending_group: false,

        production_order_id: productionOrder.id,
        production_sequence: productionOrderItem.sequence_no,
        production_sequence_mode: productionOrder.sequence_mode,

        // Production target
        stage_target_qty: targetQty,

        // Achievement
        stage_achieved_qty: stageAchievedQty,
        stage_remaining_qty: remainingQty,
        stage_achievement_percent: achievementPercent,

        // Production Order
        production_completed: productionCompleted,

        // Sequential stage
        next_expected_sequence: nextExpectedSequence,
        stage_completed: productionStageCompleted,

        packaging: packagingResult,
      },
    });

  } catch (error) {

    console.log("ERR IN SINGLE SCAN:", error);

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
    `
    SELECT result
    FROM ict_results
    WHERE machine_code = ?
      AND serial_no = ?
    ORDER BY imported_at DESC, id DESC
    LIMIT 1
    `,
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

    // ============================================================
    // 1. Production Order Validation
    // ============================================================

    const productionValidation =
      await validateProductionOrderSequence(conn, {
        factoryId: factory_id,
        productId: product_id,
        lineId: line_id,
        stageId: stage_id,
        scannedValue: scanned_value,
      });

    if (!productionValidation.ok) {

      console.log(
        "Production order validation failed:",
        productionValidation
      );

      await conn.rollback();

      return res.status(409).json({
        success: false,
        errorType: productionValidation.errorType,
        message: productionValidation.message,
        productionOrderId:
          productionValidation.productionOrderId ?? null,
        expectedSequence:
          productionValidation.expectedSequence ?? null,
        expectedSerial:
          productionValidation.expectedSerial ?? null,
        scannedSequence:
          productionValidation.scannedSequence ?? null,
        scannedSerial:
          productionValidation.scannedSerial ?? null,
      });
    }

    const {
      productionOrder,
      productionOrderItem,
      productionOrderStage,
    } = productionValidation;


    // ============================================================
    // 2. Save Scan History
    // ============================================================

    const [result] = await conn.query(
      `
      INSERT INTO scan_history
      (
        factory_id,
        line_id,
        stage_id,
        user_id,
        production_order_id,
        scanned_value,
        sequence_no,
        status,
        group_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'SUCCESS', NULL)
      `,
      [
        factory_id,
        line_id,
        stage_id,
        userId,
        productionOrder.id,
        scanned_value,
        currentSeq,
      ]
    );


    // ============================================================
    // 3. Update PCB Production State
    // ============================================================

    await syncProduction(conn, {
      scanned_value,
      product_id,
      factory_id,
      line_id,
      stage_id,
      currentSeq,
      lastSequence,
    });


    // ============================================================
    // 4. Production Achievement
    // ============================================================

    const [achievementRows] = await conn.query(
      `
      SELECT
        COUNT(DISTINCT sh.scanned_value) AS achieved_qty
      FROM scan_history sh
      WHERE sh.production_order_id = ?
        AND sh.stage_id = ?
        AND sh.status = 'SUCCESS'
      `,
      [
        productionOrder.id,
        stage_id,
      ]
    );

    const stageAchievedQty = Number(
      achievementRows[0]?.achieved_qty || 0
    );

    const targetQty = Number(
      productionOrder.target_qty || 0
    );

    const remainingQty = Math.max(
      targetQty - stageAchievedQty,
      0
    );

    const achievementPercent =
      targetQty > 0
        ? Number(
            ((stageAchievedQty / targetQty) * 100).toFixed(1)
          )
        : 0;


    // ============================================================
    // 5. Complete Production Order When Target Is Reached
    // ============================================================

    let productionCompleted = false;

    if (
      targetQty > 0 &&
      stageAchievedQty >= targetQty
    ) {

      await conn.query(
        `
        UPDATE production_orders
        SET
          status = 'COMPLETED',
          completed_at = NOW()
        WHERE id = ?
          AND status = 'RUNNING'
        `,
        [
          productionOrder.id,
        ]
      );

      productionCompleted = true;
    }


    // ============================================================
    // 6. Advance Production Order Stage
    // ============================================================

    let productionStageCompleted = false;
    let nextExpectedSequence = null;

    if (
      productionOrder.sequence_mode === "SEQUENTIAL" &&
      productionOrderStage
    ) {

      const currentExpected = Number(
        productionOrderStage.next_expected_sequence
      );

      const lastSequenceNumber = Number(
        productionOrder.serial_end
      );

      nextExpectedSequence = currentExpected + 1;

      // ----------------------------------------------------------
      // Last serial completed
      // ----------------------------------------------------------

      if (currentExpected >= lastSequenceNumber) {

        await conn.query(
          `
          UPDATE production_order_stages
          SET
            next_expected_sequence = ?,
            status = 'COMPLETED'
          WHERE id = ?
          `,
          [
            nextExpectedSequence,
            productionOrderStage.id,
          ]
        );

        productionStageCompleted = true;

      } else {

        // --------------------------------------------------------
        // Normal advancement
        // --------------------------------------------------------

        await conn.query(
          `
          UPDATE production_order_stages
          SET
            next_expected_sequence = ?
          WHERE id = ?
          `,
          [
            nextExpectedSequence,
            productionOrderStage.id,
          ]
        );
      }
    }


    // ============================================================
    // 7. Get Pending Group Items
    //
    // IMPORTANT:
    // Only return pending items belonging to this production order.
    // ============================================================

    const [pending] = await conn.query(
      `
      SELECT
        id,
        scanned_value,
        sequence_no
      FROM scan_history
      WHERE production_order_id = ?
        AND factory_id = ?
        AND line_id = ?
        AND stage_id = ?
        AND user_id = ?
        AND group_id IS NULL
        AND status = 'SUCCESS'
      ORDER BY scanned_at ASC
      `,
      [
        productionOrder.id,
        factory_id,
        line_id,
        stage_id,
        userId,
      ]
    );


    // ============================================================
    // 8. Commit
    // ============================================================

    await conn.commit();


    // ============================================================
    // 9. Response
    // ============================================================

    return res.status(201).json({
      success: true,

      message: productionCompleted
        ? "Scan recorded successfully. Production order completed."
        : "Scan recorded, pending group save.",

      data: {
        id: result.insertId,

        serial_no: scanned_value,
        sequence_no: currentSeq,

        scan_mode: "GROUP_CREATE",
        pending_group: true,
        pending_items: pending,

        // --------------------------------------------------------
        // Production Order
        // --------------------------------------------------------

        production_order_id: productionOrder.id,
        production_order_no: productionOrder.order_no,
        production_sequence: productionOrderItem.sequence_no,
        production_sequence_mode: productionOrder.sequence_mode,

        // --------------------------------------------------------
        // Production Target
        // --------------------------------------------------------

        target_qty: targetQty,

        // --------------------------------------------------------
        // Achievement
        // --------------------------------------------------------

        stage_achieved_qty: stageAchievedQty,
        stage_remaining_qty: remainingQty,
        stage_achievement_percent: achievementPercent,

        // --------------------------------------------------------
        // Production Completion
        // --------------------------------------------------------

        production_completed: productionCompleted,

        // --------------------------------------------------------
        // Sequence
        // --------------------------------------------------------

        next_expected_sequence: nextExpectedSequence,
        stage_completed: productionStageCompleted,
      },
    });

  } catch (error) {

    console.error(
      "ERR IN GROUP CREATE:",
      error
    );

    await conn.rollback();

    throw error;
  }
};

// ---- GROUP_SCAN ----
const handleGroupScan = async (conn, res, ctx) => {
  const {
    factory_id,
    line_id,
    stage_id,
    userId,
    scanned_value: code,
    product_id,
    currentSeq,
    lastSequence,
  } = ctx;

  try {
    // ============================================================
    // 1. Find the group from the scanned item
    // ============================================================

    const [lastRows] = await conn.query(
      `
      SELECT
        group_id,
        sequence_no
      FROM scan_history
      WHERE scanned_value = ?
        AND status = 'SUCCESS'
      ORDER BY sequence_no DESC, scanned_at DESC
      LIMIT 1
      `,
      [code]
    );

    if (!lastRows.length) {
      return res.status(400).json({
        success: false,
        errorType: "ITEM_NOT_GROUPED",
        message:"This item is not grouped yet. Please create a group first before scanning.",
      });
    }

    const {
      group_id: groupId,
      sequence_no: lastSeq,
    } = lastRows[0];

    // ============================================================
    // 2. Group must exist
    // ============================================================

    if (!groupId) {
      return res.status(400).json({
        success: false,
        errorType: "GROUP_NOT_FOUND",
        message: "This item is not part of a group yet. Please create the group first.",
      });
    }

    // ============================================================
    // 3. Previous stage validation
    // ============================================================

    if (lastSeq !== currentSeq - 1) {
      return res.status(400).json({
        success: false,
        errorType: "PREVIOUS_STAGE_NOT_COMPLETED",
        message: lastSeq >= currentSeq ? "This item is already scanned at this stage or beyond." : "Previous stage has not been completed for this item.",
      });
    }

    // ============================================================
    // 4. Get Group
    // ============================================================

    const [groupRows] = await conn.query(
      `
      SELECT
        id,
        product_id
      FROM scan_groups
      WHERE id = ?
      LIMIT 1
      `,
      [groupId]
    );

    if (!groupRows.length) {
      return res.status(400).json({
        success: false,
        errorType: "GROUP_NOT_FOUND",
        message: "Group record not found.",
      });
    }

    const group = groupRows[0];

    // ============================================================
    // 5. Group Product Validation
    // ============================================================

    if (Number(group.product_id) !== Number(product_id)) {
      return res.status(400).json({
        success: false,
        errorType: "PRODUCT_MISMATCH",
        message: "This group does not belong to the selected product.",
      });
    }

    // ============================================================
    // 6. Get ALL group members
    // ============================================================

    const [members] = await conn.query(
      `
      SELECT DISTINCT
        scanned_value
      FROM scan_history
      WHERE group_id = ?
        AND status = 'SUCCESS'
      `,
      [groupId]
    );

    if (!members.length) {
      return res.status(400).json({
        success: false,
        errorType: "EMPTY_GROUP",
        message: "Group has no member items.",
      });
    }

    console.log(`📦 Group ${groupId} contains ${members.length} items`);

    // ============================================================
    // 7. START TRANSACTION
    // ============================================================

    await conn.beginTransaction();

    try {
      // ==========================================================
      // 8. Validate EVERY group member against Production Order
      // ==========================================================


      let productionOrder = null;
      let productionOrderStage = null;

      // ----------------------------------------------------------
      // First member determines the production order
      // ----------------------------------------------------------

      const firstProductionValidation =
        await validateProductionOrderSequence(conn, {
          factoryId: factory_id,
          productId: product_id,
          lineId: line_id,
          stageId: stage_id,
          scannedValue: members[0].scanned_value,
        });

      if (!firstProductionValidation.ok) {
        await conn.rollback();

        return res.status(409).json({
          success: false,
          errorType: firstProductionValidation.errorType,
          message: `Item ${members[0].scanned_value}: ` + firstProductionValidation.message,
          productionOrderId: firstProductionValidation.productionOrderId ?? null,
          expectedSequence: firstProductionValidation.expectedSequence ?? null,
          expectedSerial: firstProductionValidation.expectedSerial ?? null,
          scannedSequence: firstProductionValidation.scannedSequence ?? null,
          scannedSerial: firstProductionValidation.scannedSerial ?? null,
        });
      }

      productionOrder = firstProductionValidation.productionOrder;

      productionOrderStage = firstProductionValidation.productionOrderStage;


      // ==========================================================
      // 8.1 NON-SEQUENTIAL
      // ==========================================================

      if (productionOrder.sequence_mode === "NON_SEQUENTIAL") {

        for (const member of members) {

          const productionValidation =
            await validateProductionOrderSequence(conn, {
              factoryId: factory_id,
              productId: product_id,
              lineId: line_id,
              stageId: stage_id,
              scannedValue: member.scanned_value,
            });

          if (!productionValidation.ok) {
            await conn.rollback();

            return res.status(409).json({
              success: false,
              errorType: productionValidation.errorType,
              message: `Item ${member.scanned_value}: ` + productionValidation.message,
              productionOrderId: productionValidation.productionOrderId ?? null,
            });
          }

          // Make sure every item belongs to the SAME order
          if (Number(productionOrder.id) !== Number(productionValidation.productionOrder.id)) {
            await conn.rollback();

            return res.status(409).json({
              success: false,
              errorType: "MULTIPLE_PRODUCTION_ORDERS_IN_GROUP",
              message: "Group contains items from different production orders.",
            });
          }
        }
      }


      // ==========================================================
      // 8.2 SEQUENTIAL
      // ==========================================================

      if (productionOrder.sequence_mode === "SEQUENTIAL") {

        const expectedSequence = Number(productionOrderStage.next_expected_sequence);

        // --------------------------------------------------------
        // Get sequence numbers for ALL group members
        // --------------------------------------------------------

        const placeholders = members.map(() => "?").join(",");
        const memberSerials = members.map((member) => member.scanned_value);

        const [sequenceRows] = await conn.query(
          `
          SELECT
            serial_no,
            sequence_no,
            production_order_id,
            status
          FROM production_order_items
          WHERE production_order_id = ?
            AND serial_no IN (${placeholders})
          ORDER BY sequence_no ASC
          `,
          [
            productionOrder.id,
            ...memberSerials,
          ]
        );

        // --------------------------------------------------------
        // Every member must exist in the same production order
        // --------------------------------------------------------

        if (sequenceRows.length !== members.length) {
          await conn.rollback();

          return res.status(409).json({
            success: false,
            errorType: "INVALID_GROUP_PRODUCTION_ORDER",
            message: "One or more group items do not belong to the active production order.",
            productionOrderId: productionOrder.id,
          });
        }

        // --------------------------------------------------------
        // Rejected item check
        // --------------------------------------------------------

        const rejectedItem = sequenceRows.find((item) => item.status === "REJECTED");

        if (rejectedItem) {
          await conn.rollback();

          return res.status(409).json({
            success: false,
            errorType: "SERIAL_REJECTED",
            message: `Item ${rejectedItem.serial_no} has been rejected and cannot continue production.`,
            productionOrderId: productionOrder.id,
            scannedSerial: rejectedItem.serial_no,
          });
        }

        // --------------------------------------------------------
        // IMPORTANT:
        // Group must be a CONTINUOUS sequence
        // --------------------------------------------------------

        for (let index = 0; index < sequenceRows.length; index++) {

          const expectedForMember = expectedSequence + index;
          const actualSequence = Number(sequenceRows[index].sequence_no);

          if (actualSequence !== expectedForMember) {
            await conn.rollback();

            const expectedRow = await conn.query(
                `
                SELECT serial_no
                FROM production_order_items
                WHERE production_order_id = ?
                  AND sequence_no = ?
                LIMIT 1
                `,
                [
                  productionOrder.id,
                  expectedForMember,
                ]
              );

            const expectedSerial = expectedRow[0].length ? expectedRow[0][0].serial_no : null;

            return res.status(409).json({
              success: false,
              errorType: "SEQUENCE_GROUP_INVALID",
              message: `Invalid group sequence. Expected ${expectedSerial} ` + `at sequence ${expectedForMember}, ` + `but group contains ${sequenceRows[index].serial_no}.`,
              productionOrderId: productionOrder.id,
              expectedSequence: expectedForMember,
              expectedSerial,
              scannedSequence: actualSequence,
              scannedSerial: sequenceRows[index].serial_no,
            });
          }
        }

        // --------------------------------------------------------
        // Also ensure group does not exceed production order
        // --------------------------------------------------------

        const groupLastSequence =expectedSequence + sequenceRows.length - 1;
        const productionLastSequence = Number(productionOrder.serial_end);

        if (groupLastSequence > productionLastSequence) {
          await conn.rollback();
          return res.status(409).json({
            success: false,
            errorType: "GROUP_EXCEEDS_PRODUCTION_ORDER",
            message: "The group contains more items than the remaining production order quantity.",
            productionOrderId: productionOrder.id,
            expectedSequence,
            productionLastSequence,
          });
        }
      }

      // ==========================================================
      // 9. Validate stage sequence for EVERY group member
      // ==========================================================

      for (const member of members) {
        const validation = await validateScanSequence(conn, {
          scanned_value: member.scanned_value,
          stage_id,
          product_id,
          currentSeq,
        });

        if (!validation.ok) {
          await conn.rollback();

          return res.status(400).json({
            success: false,
            errorType: validation.errorType,
            message: `Item ${member.scanned_value}: ${validation.message}`,
            missing: validation.missing ?? null,
          });
        }
      }

      // ==========================================================
      // 10. Insert scan history for ALL members
      // ==========================================================

      const insertedIds = [];

      for (const member of members) {
        const [result] = await conn.query(
          `
          INSERT INTO scan_history
          (
            factory_id,
            line_id,
            stage_id,
            user_id,
            production_order_id,
            scanned_value,
            sequence_no,
            status,
            group_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'SUCCESS', ?)
          `,
          [
            factory_id,
            line_id,
            stage_id,
            userId,
            productionOrder.id,
            member.scanned_value,
            currentSeq,
            groupId,
          ]
        );

        // ========================================================
        // Update PCB production state
        // ========================================================

        await syncProduction(conn, {
          scanned_value: member.scanned_value,
          product_id,
          factory_id,
          line_id,
          stage_id,
          currentSeq,
          lastSequence,
        });

        insertedIds.push(result.insertId);
      }

      // ==========================================================
      // 11. Production Achievement
      // ==========================================================

      const [achievementRows] = await conn.query(
        `
        SELECT
          COUNT(DISTINCT sh.scanned_value) AS achieved_qty
        FROM scan_history sh
        WHERE sh.production_order_id = ?
          AND sh.stage_id = ?
          AND sh.status = 'SUCCESS'
        `,
        [
          productionOrder.id,
          stage_id,
        ]
      );

      const stageAchievedQty = Number(achievementRows[0]?.achieved_qty || 0);
      const targetQty = Number(productionOrder.target_qty || 0);
      const remainingQty = Math.max(targetQty - stageAchievedQty, 0);
      const achievementPercent = targetQty > 0 ? Number(((stageAchievedQty / targetQty) * 100).toFixed(1)) : 0;


      // ==========================================================
      // 12. Complete Production Order When Target Is Reached
      // ==========================================================

      let productionCompleted = false;

      if (
        targetQty > 0 &&
        stageAchievedQty >= targetQty
      ) {

        await conn.query(
          `
          UPDATE production_orders
          SET
            status = 'COMPLETED',
            completed_at = NOW()
          WHERE id = ?
            AND status = 'RUNNING'
          `,
          [
            productionOrder.id,
          ]
        );

        productionCompleted = true;
      }


      // ==========================================================
      // 13. Advance Production Order Stage
      // ==========================================================

      let productionStageCompleted = false;
      let nextExpectedSequence = null;

      if (productionOrder.sequence_mode === "SEQUENTIAL") {
        const currentExpected =Number(productionOrderStage.next_expected_sequence);
        const lastSequenceNumber = Number(productionOrder.serial_end);
        nextExpectedSequence =currentExpected + members.length;

        // --------------------------------------------------------
        // Production order finished at this stage
        // --------------------------------------------------------

        if (nextExpectedSequence > lastSequenceNumber) {
          nextExpectedSequence = lastSequenceNumber + 1;

          await conn.query(
            `
            UPDATE production_order_stages
            SET
              next_expected_sequence = ?,
              status = 'COMPLETED'
            WHERE id = ?
            `,
            [
              nextExpectedSequence,
              productionOrderStage.id,
            ]
          );

          productionStageCompleted = true;

        } else {
          await conn.query(
            `
            UPDATE production_order_stages
            SET
              next_expected_sequence = ?
            WHERE id = ?
            `,
            [
              nextExpectedSequence,
              productionOrderStage.id,
            ]
          );
        }
      }

      // ==========================================================
      // 13. Commit
      // ==========================================================

      await conn.commit();

      // ==========================================================
      // 14. Response
      // ==========================================================

      return res.status(201).json({
        success: true,
        message:"Group scan recorded successfully.",

        data: {
          group_id: groupId,
          items_advanced: insertedIds.length,
          sequence_no: currentSeq,
          scan_mode: "GROUP_SCAN",

          // ------------------------------------------------------
          // Production Order
          // ------------------------------------------------------

          production_order_id: productionOrder.id,
          production_order_no: productionOrder.order_no,
          production_sequence_mode: productionOrder.sequence_mode,

          // ------------------------------------------------------
          // Production Target
          // ------------------------------------------------------

          target_qty: targetQty,

          // ------------------------------------------------------
          // Achievement
          // ------------------------------------------------------

          stage_achieved_qty: stageAchievedQty,
          stage_remaining_qty: remainingQty,
          stage_achievement_percent: achievementPercent,

          // ------------------------------------------------------
          // Sequence
          // ------------------------------------------------------

          next_expected_sequence: nextExpectedSequence,
          stage_completed: productionStageCompleted,
        },
      });

    } catch (error) {
      await conn.rollback();
      throw error;
    }

  } catch (error) {
    console.error(
      "ERR IN GROUP SCAN:",
      error
    );

    throw error;
  }
};


export const handleCustomerBinding = async (conn, res, ctx) => {
  const {
    factory_id,
    line_id,
    stage_id,
    userId,
    scanned_value,
    customer_qr,
    product_id,
    currentSeq,
    lastSequence,
  } = ctx;

  console.log("CUSTOMER BINDING CTX:", ctx);

  const pcbQr = String(scanned_value || "").trim();
  const customerQr = String(customer_qr || "").trim();

  // ============================================================
  // 1. Basic validation
  // ============================================================

  if (!pcbQr) {
    return res.status(400).json({
      success: false,
      errorType: "PCB_QR_REQUIRED",
      message: "PCB QR is required.",
    });
  }

  if (!customerQr) {
    return res.status(400).json({
      success: false,
      errorType: "CUSTOMER_QR_REQUIRED",
      message: "Customer QR is required.",
    });
  }

  // ============================================================
  // 2. PCB QR and Customer QR cannot be same
  // ============================================================

  if (pcbQr === customerQr) {
    return res.status(400).json({
      success: false,
      errorType: "INVALID_CUSTOMER_QR",
      message: "PCB QR and Customer QR cannot be the same.",
    });
  }

  // ============================================================
  // 3. Production Order Validation
  // ============================================================

  const productionValidation =
    await validateProductionOrderSequence(conn, {
      factoryId: factory_id,
      productId: product_id,
      lineId: line_id,
      stageId: stage_id,
      scannedValue: pcbQr,
    });

  if (!productionValidation.ok) {
    console.log(
      "Customer binding production validation failed:",
      productionValidation
    );

    return res.status(409).json({
      success: false,
      errorType: productionValidation.errorType,
      message: productionValidation.message,
      productionOrderId: productionValidation.productionOrderId ?? null,
      expectedSequence: productionValidation.expectedSequence ?? null,
      expectedSerial: productionValidation.expectedSerial ?? null,
      scannedSequence: productionValidation.scannedSequence ?? null,
      scannedSerial: productionValidation.scannedSerial ?? null,
    });
  }

  const {
    productionOrder,
    productionOrderItem,
    productionOrderStage,
  } = productionValidation;

  // ============================================================
  // 4. Customer QR must not be another PCB serial
  // ============================================================

  const [customerAsPcbRows] = await conn.query(
    `
    SELECT id
    FROM production_order_items
    WHERE serial_no = ?
    LIMIT 1
    `,
    [customerQr]
  );

  if (customerAsPcbRows.length) {
    return res.status(400).json({
      success: false,
      errorType: "CUSTOMER_QR_IS_PCB",
      message:
        `"${customerQr}" is a PCB serial and cannot be used as a Customer QR.`,
    });
  }

  // ============================================================
  // 5. Check whether PCB is already bound
  // ============================================================

  const [existingBindingRows] = await conn.query(
    `
    SELECT
      id,
      pcb_qr,
      customer_qr,
      created_at
    FROM customer_bindings
    WHERE pcb_qr = ?
    LIMIT 1
    `,
    [pcbQr]
  );

  if (existingBindingRows.length) {
    const existing = existingBindingRows[0];

    return res.status(409).json({
      success: false,
      errorType: "PCB_ALREADY_BOUND",
      message: `"${pcbQr}" is already bound to a customer.`,
      data: {
        binding_id: existing.id,
        pcb_qr: existing.pcb_qr,
        customer_qr: existing.customer_qr,
        created_at: existing.created_at,
      },
    });
  }

  // ============================================================
  // 6. Create Binding + Scan History + Production State
  // ============================================================

  await conn.beginTransaction();

  try {
    // ==========================================================
    // 6.1 Create Customer Binding
    // ==========================================================

    const [bindingResult] = await conn.query(
      `
      INSERT INTO customer_bindings
      (
        pcb_qr,
        customer_qr,
        product_id,
        production_order_id,
        factory_id,
        line_id,
        stage_id,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        pcbQr,
        customerQr,
        productionOrder.product_id,
        productionOrder.id,
        factory_id,
        line_id,
        stage_id,
        userId,
      ]
    );

    const bindingId = bindingResult.insertId;

    // ==========================================================
    // 6.2 Record Scan History
    // ==========================================================

    const [historyResult] = await conn.query(
      `
      INSERT INTO scan_history
      (
        factory_id,
        line_id,
        stage_id,
        user_id,
        production_order_id,
        scanned_value,
        sequence_no,
        status,
        group_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'SUCCESS', NULL)
      `,
      [
        factory_id,
        line_id,
        stage_id,
        userId,
        productionOrder.id,
        pcbQr,
        currentSeq,
      ]
    );

    // ==========================================================
    // 6.3 Update PCB Production State
    // ==========================================================

    await syncProduction(conn, {
      scanned_value: pcbQr,
      product_id,
      factory_id,
      line_id,
      stage_id,
      currentSeq,
      lastSequence,
    });

    // ==========================================================
    // 6.4 Production Achievement
    // ==========================================================

    const [achievementRows] = await conn.query(
      `
      SELECT
        COUNT(DISTINCT sh.scanned_value) AS achieved_qty
      FROM scan_history sh
      WHERE sh.production_order_id = ?
        AND sh.stage_id = ?
        AND sh.status = 'SUCCESS'
      `,
      [
        productionOrder.id,
        stage_id,
      ]
    );

    const stageAchievedQty = Number(
      achievementRows[0]?.achieved_qty || 0
    );

    const targetQty = Number(
      productionOrder.target_qty || 0
    );

    const remainingQty = Math.max(
      targetQty - stageAchievedQty,
      0
    );

    const achievementPercent =
      targetQty > 0
        ? Number(
            ((stageAchievedQty / targetQty) * 100).toFixed(1)
          )
        : 0;

    // ==========================================================
    // 6.5 Complete Production Order When Target Is Reached
    // ==========================================================

    let productionCompleted = false;

    if (
      targetQty > 0 &&
      stageAchievedQty >= targetQty
    ) {
      await conn.query(
        `
        UPDATE production_orders
        SET
          status = 'COMPLETED',
          completed_at = NOW()
        WHERE id = ?
          AND status = 'RUNNING'
        `,
        [productionOrder.id]
      );

      productionCompleted = true;
    }

    // ==========================================================
    // 6.6 Advance Production Order Stage
    // ==========================================================

    let productionStageCompleted = false;
    let nextExpectedSequence = null;

    if (
      productionOrder.sequence_mode === "SEQUENTIAL" &&
      productionOrderStage
    ) {
      const currentExpected = Number(
        productionOrderStage.next_expected_sequence
      );

      const lastSequenceNumber = Number(
        productionOrder.serial_end
      );

      nextExpectedSequence = currentExpected + 1;

      if (currentExpected >= lastSequenceNumber) {
        await conn.query(
          `
          UPDATE production_order_stages
          SET
            next_expected_sequence = ?,
            status = 'COMPLETED'
          WHERE id = ?
          `,
          [
            nextExpectedSequence,
            productionOrderStage.id,
          ]
        );

        productionStageCompleted = true;

      } else {
        await conn.query(
          `
          UPDATE production_order_stages
          SET
            next_expected_sequence = ?
          WHERE id = ?
          `,
          [
            nextExpectedSequence,
            productionOrderStage.id,
          ]
        );
      }
    }

    // ==========================================================
    // 7. Commit
    // ==========================================================

    await conn.commit();

    // ==========================================================
    // 8. Response
    // ==========================================================

    return res.status(201).json({
      success: true,

      message: productionCompleted
        ? "Customer binding created successfully. Production order completed."
        : "Customer binding created successfully.",

      data: {
        id: historyResult.insertId,

        serial_no: pcbQr,
        sequence_no: currentSeq,

        scan_mode: "CUSTOMER_BINDING",
        pending_group: false,

        // Customer Binding
        customer_binding_id: bindingId,

        customer_qr: customerQr,

        // Production Order
        production_order_id: productionOrder.id,
        production_sequence: productionOrderItem.sequence_no,
        production_sequence_mode: productionOrder.sequence_mode,

        // Production target
        stage_target_qty: targetQty,

        // Achievement
        stage_achieved_qty: stageAchievedQty,
        stage_remaining_qty: remainingQty,
        stage_achievement_percent: achievementPercent,

        // Production Order
        production_completed: productionCompleted,

        // Sequential stage
        next_expected_sequence: nextExpectedSequence,
        stage_completed: productionStageCompleted,
      },
    });

  } catch (error) {
    console.log("ERR IN CUSTOMER BINDING:", error);

    await conn.rollback();

    throw error;
  }
};

export const submitScan = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { scanned_value, customer_qr, product_id } = req.body;
    const userId = req?.user?.id;

    console.log("CUSTOMER BINDING REQUEST:", req.body);

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

          /* Printer details — needed by the frontend to target the
             correct printer name in QZ Tray's print config */
          pr.printer_name,
          pr.printer_type,

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

      LEFT JOIN printers pr
          ON pr.id = pc.printer_id

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
      printer_name,   
    } = flowRows[0];


    const ctx = {
      factory_id,
      line_id,
      stage_id,
      userId,
      scanned_value,
      customer_qr,
      product_id,

      currentSeq,
      lastSequence,

      // Packaging
      packaging_config_id,
      box_size,
      printer_id,
      barcode_format,
      printer_name,   
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

      case "CUSTOMER_BINDING":
        return await handleCustomerBinding(conn, res, ctx);

      default:
        return res.status(400).json({
          success: false,
          message: "Invalid scan mode"
        });
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

    if (!Array.isArray(scanned_values) || !scanned_values.length)
      return res.status(400).json({ success: false, message: "scanned_values array is required" });

    if (!product_id)
      return res.status(400).json({ success: false, message: "product_id is required" });

    const uniqueValues = [...new Set(scanned_values.map(v => String(v).trim()).filter(Boolean))];

    if (uniqueValues.length !== scanned_values.length)
      return res.status(400).json({ success: false, message: "Duplicate codes found in the scanned batch." });

    const [userRows] = await conn.query(
      `SELECT id, factory_id, line_id, stage_id FROM users WHERE id = ?`,
      [userId]
    );

    if (!userRows.length)
      return res.status(401).json({ success: false, message: "User not found" });

    const { factory_id, line_id, stage_id } = userRows[0];

    if (!stage_id)
      return res.status(400).json({ success: false, message: "User is not assigned to a stage" });

    const [flowRows] = await conn.query(
      `SELECT sequence_no, scan_mode FROM product_stage_flow WHERE product_id = ? AND stage_id = ?`,
      [product_id, stage_id]
    );

    if (!flowRows.length)
      return res.status(400).json({ success: false, message: "This stage is not part of the product's flow" });

    const { sequence_no: currentSeq, scan_mode } = flowRows[0];

    if (scan_mode !== "GROUP_CREATE")
      return res.status(400).json({ success: false, message: "This stage does not use GROUP_CREATE mode" });

    // ============================================================
    // Production Order + Stage Validation
    // ============================================================

    const productionItems = [];

    for (const scanned_value of uniqueValues) {
      const productionValidation = await validateProductionOrderSequence(conn, {
        factoryId: factory_id,
        productId: product_id,
        lineId: line_id,
        stageId: stage_id,
        scannedValue: scanned_value,
      });

      if (!productionValidation.ok) {
        return res.status(409).json({
          success: false,
          errorType: productionValidation.errorType,
          message: productionValidation.message,
          productionOrderId: productionValidation.productionOrderId ?? null,
          expectedSequence: productionValidation.expectedSequence ?? null,
          expectedSerial: productionValidation.expectedSerial ?? null,
          scannedSequence: productionValidation.scannedSequence ?? null,
          scannedSerial: productionValidation.scannedSerial ?? null,
        });
      }

      const sequenceValidation = await validateScanSequence(conn, {
        scanned_value,
        stage_id,
        product_id,
        currentSeq,
      });

      if (!sequenceValidation.ok)
        return res.status(400).json({ success: false, message: sequenceValidation.message });

      productionItems.push({
        scanned_value,
        productionOrder: productionValidation.productionOrder,
        productionOrderItem: productionValidation.productionOrderItem,
        productionOrderStage: productionValidation.productionOrderStage,
      });
    }

    // ============================================================
    // Ensure all scanned items belong to the same Production Order
    // ============================================================

    const productionOrderIds = [...new Set(productionItems.map(item => item.productionOrder.id))];

    if (productionOrderIds.length !== 1) {
      return res.status(409).json({
        success: false,
        errorType: "MULTIPLE_PRODUCTION_ORDERS",
        message: "All scanned items in a group must belong to the same production order.",
        productionOrderIds,
      });
    }

    const productionOrder = productionItems[0].productionOrder;
    const productionOrderId = productionOrder.id;

    // ============================================================
    // Start Transaction
    // ============================================================

    await conn.beginTransaction();

    try {
      const group_code = `GRP-${stage_id}-${Date.now()}`;

      const [groupResult] = await conn.query(
        `INSERT INTO scan_groups
        (group_code, product_id, factory_id, line_id, stage_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [group_code, product_id, factory_id, line_id, stage_id, userId]
      );

      const groupId = groupResult.insertId;
      const insertedIds = [];

      for (const item of productionItems) {
        const [result] = await conn.query(
          `INSERT INTO scan_history
          (factory_id, line_id, stage_id, user_id, production_order_id, scanned_value, sequence_no, status, group_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'SUCCESS', ?)`,
          [
            factory_id,
            line_id,
            stage_id,
            userId,
            productionOrderId,
            item.scanned_value,
            currentSeq,
            groupId,
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
          product_id,
          production_order_id: productionOrderId,
          sequence_no: currentSeq,
          scan_mode: "GROUP_CREATE",
          item_count: insertedIds.length,
          scan_history_ids: insertedIds,
          scanned_items: productionItems.map(item => ({
            serial_no: item.scanned_value,
            production_sequence: item.productionOrderItem?.sequence_no ?? null,
          })),
        },
      });

    } catch (err) {
      await conn.rollback();
      throw err;
    }

  } catch (error) {
    console.log("ERR IN CREATE GROUP:", error);

    if (conn.connection?._closing === false) {
      try {
        await conn.rollback();
      } catch {}
    }

    return res.status(500).json({
      success: false,
      message: error.message,
    });

  } finally {
    conn.release();
  }
};

export const getTenLatestScans = async (req, res) => {
  const conn = await pool.getConnection();

  try {

    const {
      factory_id,
      product_id,
      line_id,
      stage_id,
    } = req.params;

    if (
      !factory_id ||
      !product_id ||
      !line_id ||
      !stage_id
    ) {
      return res.status(400).json({
        success: false,
        message:
          "factory_id, product_id, line_id and stage_id are required.",
      });
    }

    const [rows] = await conn.query(
      `
      SELECT
        sh.id,
        sh.scanned_value,
        sh.sequence_no,
        sh.status,
        sh.scanned_at,

        u.username AS scanned_by,

        p.name AS product_name,

        po.order_no AS production_order_no,

        s.name AS stage_name

      FROM scan_history sh

      LEFT JOIN users u
        ON u.id = sh.user_id

      INNER JOIN production_orders po
        ON po.id = sh.production_order_id

      INNER JOIN products p
        ON p.id = po.product_id

      LEFT JOIN stages s
        ON s.id = sh.stage_id

      WHERE sh.factory_id = ?
        AND sh.line_id = ?
        AND sh.stage_id = ?
        AND po.product_id = ?
        AND sh.status = 'SUCCESS'

      ORDER BY sh.scanned_at DESC

      LIMIT 10
      `,
      [
        factory_id,
        line_id,
        stage_id,
        product_id,
      ]
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });

  } catch (error) {

    console.error(
      "ERR IN GET TEN LATEST SCANS:",
      error
    );

    return res.status(500).json({
      success: false,
      message: error.message,
    });

  } finally {
    conn.release();
  }
};