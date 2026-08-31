import {generateNextBarcode} from "../BarCode-Generator/barCodeGenerator.js";

export const processPackagingScan = async (
    conn,
    {
        product_id,
        stage_id,
        scanned_value,
        box_size,
        printer_id,
        barcode_format,
        packaging_config_id,
        printer_name,
    }
) => {

    

    // --------------------------------------------------
    // 1. Find current open box
    // --------------------------------------------------

    const [boxRows] = await conn.query(
        `
        SELECT
            id,
            box_code,
            barcode_data,
            product_id,
            packaging_stage_id,
            box_size,
            actual_quantity,
            status
        FROM boxes
        WHERE product_id = ?
          AND packaging_stage_id = ?
          AND status IN ('OPEN', 'PACKING')
        ORDER BY id DESC
        LIMIT 1
        FOR UPDATE
        `,
        [
            product_id,
            stage_id
        ]
    );

    let box;

    // --------------------------------------------------
    // 2. Create box if none exists
    // --------------------------------------------------

    if (!boxRows.length) {

        if (!packaging_config_id) {
            throw new Error(
                "No packaging rule configured for this product/stage — cannot generate a box barcode."
            );
        }

        const boxCode =
            `BOX-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const barcodeData = await generateNextBarcode(
            conn,
            packaging_config_id
        );

        const [insertBox] = await conn.query(
            `
            INSERT INTO boxes
            (
                box_code,
                barcode_data,
                product_id,
                packaging_stage_id,
                box_size,
                actual_quantity,
                status
            )
            VALUES (?, ?, ?, ?, ?, 0, 'OPEN')
            `,
            [
                boxCode,
                barcodeData,
                product_id,
                stage_id,
                box_size
            ]
        );

        box = {
            id: insertBox.insertId,
            box_code: boxCode,
            barcode_data: barcodeData,
            product_id,
            packaging_stage_id: stage_id,
            box_size,
            actual_quantity: 0,
            status: "OPEN"
        };

    } else {

        box = boxRows[0];

        // --------------------------------------------------
        // Safety: Existing box has no barcode
        // --------------------------------------------------

        if (!box.barcode_data) {

            if (!packaging_config_id) {
                throw new Error(
                    `Box ${box.box_code} has no barcode_data and no packaging configuration is available.`
                );
            }

            const barcodeData = await generateNextBarcode(
                conn,
                packaging_config_id
            );

            await conn.query(
                `
                UPDATE boxes
                SET
                    barcode_data = ?,
                    updated_at = NOW()
                WHERE id = ?
                `,
                [
                    barcodeData,
                    box.id
                ]
            );

            box.barcode_data = barcodeData;
        }
    }


    // --------------------------------------------------
    // 3. Safety check
    // --------------------------------------------------

    if (Number(box.actual_quantity) >= Number(box.box_size)) {
        throw new Error(
            `Box ${box.box_code} is already full.`
        );
    }


    // --------------------------------------------------
    // 4. Prevent PCB from being assigned to another box
    // --------------------------------------------------

    const [existingItem] = await conn.query(
        `
        SELECT
            id,
            box_id
        FROM box_items
        WHERE serial_no = ?
        LIMIT 1
        `,
        [scanned_value]
    );

    if (existingItem.length) {
        throw new Error(
            `"${scanned_value}" is already assigned to a box.`
        );
    }


    // --------------------------------------------------
    // 5. Add PCB to box
    // --------------------------------------------------

    await conn.query(
        `
        INSERT INTO box_items
        (
            box_id,
            serial_no,
            product_id
        )
        VALUES (?, ?, ?)
        `,
        [
            box.id,
            scanned_value,
            product_id
        ]
    );


    // --------------------------------------------------
    // 6. Calculate quantity
    // --------------------------------------------------

    const newQuantity = Number(box.actual_quantity) + 1;


    // --------------------------------------------------
    // 7. Box FULL
    // --------------------------------------------------

    if (newQuantity === Number(box.box_size)) {

        await conn.query(
            `
            UPDATE boxes
            SET
                actual_quantity = ?,
                status = 'PACKED',
                packed_at = NOW(),
                closed_at = NOW(),
                updated_at = NOW()
            WHERE id = ?
            `,
            [
                newQuantity,
                box.id
            ]
        );


        // --------------------------------------------------
        // Create print job ONLY when box is full
        // --------------------------------------------------

        const [printJobResult] = await conn.query(
            `
            INSERT INTO box_print_jobs
            (
                box_id,
                printer_id,
                barcode_data,
                status
            )
            VALUES (?, ?, ?, 'PENDING')
            `,
            [
                box.id,
                printer_id,
                box.barcode_data
            ]
        );


        // --------------------------------------------------
        // Get label data
        // --------------------------------------------------

        const [productRows] = await conn.query(
            `
            SELECT
                name,
                part_code,
                erp_no
            FROM products
            WHERE id = ?
            LIMIT 1
            `,
            [product_id]
        );

        const product = productRows[0];

        return {
            box_completed: true,
            box_id: box.id,
            box_code: box.box_code,
            barcode_data: box.barcode_data,

            product_name: product?.name ?? null,
            part_code: product?.part_code ?? null,
            sap_code: product?.erp_no ?? null,

            print_job_id: printJobResult.insertId,
            printer_name,

            quantity: newQuantity,
            box_size: box.box_size,
            status: "PACKED",
            print_job_created: true,
            barcode_format,

            packed_at: new Date()
        };
    }


    // --------------------------------------------------
    // 8. Box still filling
    // --------------------------------------------------

    await conn.query(
        `
        UPDATE boxes
        SET
            actual_quantity = ?,
            status = 'PACKING',
            updated_at = NOW()
        WHERE id = ?
        `,
        [
            newQuantity,
            box.id
        ]
    );


    // --------------------------------------------------
    // No print job until box is FULL
    // --------------------------------------------------

    return {
        box_completed: false,
        box_id: box.id,
        box_code: box.box_code,
        barcode_data: box.barcode_data,
        printer_name,
        quantity: newQuantity,
        box_size: box.box_size,
        status: "PACKING",
        print_job_created: false,
        barcode_format
    };
    
};