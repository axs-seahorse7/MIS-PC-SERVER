export const processPackagingScan = async (
    conn,
    {
        product_id,
        stage_id,
        scanned_value,
        box_size,
        printer_id,
        barcode_format
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

        const boxCode =
            `BOX-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const [insertBox] = await conn.query(
            `
            INSERT INTO boxes
            (
                box_code,
                product_id,
                packaging_stage_id,
                box_size,
                actual_quantity,
                status
            )
            VALUES (?, ?, ?, ?, 0, 'OPEN')
            `,
            [
                boxCode,
                product_id,
                stage_id,
                box_size
            ]
        );

        box = {
            id: insertBox.insertId,
            box_code: boxCode,
            product_id,
            packaging_stage_id: stage_id,
            box_size,
            actual_quantity: 0,
            status: "OPEN"
        };

    } else {

        box = boxRows[0];
    }


    // --------------------------------------------------
    // 3. Safety check
    // --------------------------------------------------

    if (box.actual_quantity >= box.box_size) {
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

    const newQuantity =
        Number(box.actual_quantity) + 1;


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


        // ----------------------------------------------
        // Create print job
        // ----------------------------------------------

        const barcodeData = box.box_code;

        await conn.query(
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
                barcodeData
            ]
        );


        return {
            box_completed: true,
            box_id: box.id,
            box_code: box.box_code,
            quantity: newQuantity,
            box_size: box.box_size,
            status: "PACKED",
            print_job_created: true,
            barcode_data: barcodeData,
            barcode_format
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


    return {
        box_completed: false,
        box_id: box.id,
        box_code: box.box_code,
        quantity: newQuantity,
        box_size: box.box_size,
        status: "PACKING"
    };
};