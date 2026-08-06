import { pool } from "../DB/config/mysql.config.js";


const normalizeResult = (result) => {
    if (!result) return null;

    const value = result.trim().toUpperCase();

    const match = value.match(/\b(PASS|FAIL)\b/);

    return match ? match[1] : null;
};


export const saveICTResult = async (req, res) => {

    const startTime = process.hrtime.bigint();

    try {

        const {
            serialNo,
            program,
            result,
            machineName,
            machineCode,
        } = req.body;

        const cleanResult = normalizeResult(result);
        console.log(`Cleaned Result: ${cleanResult}`);

        if (!["PASS", "FAIL"].includes(cleanResult)) {
            return res.status(400).json({
                success: false,
                message: `Invalid machine result: ${cleanResult}`
            });
        }

        console.log("====================================");
        console.log("📥 ICT Result Received");
        console.log({
            serialNo,
            program,
            cleanResult,
            machineName,
            machineCode
        });

        if(!serialNo || !cleanResult || !machineName || !machineCode) {
            const endTime = process.hrtime.bigint();
            const elapsedMs = Number(endTime - startTime) / 1_000_000;

            console.error("❌ Missing required fields");
            console.log(`⚡ Failed after: ${elapsedMs.toFixed(2)} ms`);
            return res.status(400).json({
                success: false,
                processingTime: `${elapsedMs.toFixed(2)} ms`,
                message: "Missing required fields"
            });
        }
        
        

        const [resultRows] = await pool.query(
            "INSERT INTO ict_results (serial_no, program, result, machine_name, machine_code) VALUES (?, ?, ?, ?, ?)",
            [serialNo, program, cleanResult, machineName, machineCode]
        );
        

        const endTime = process.hrtime.bigint();

        const elapsedMs = Number(endTime - startTime) / 1_000_000;

        console.log(`⚡ Server Processing Time: ${elapsedMs.toFixed(2)} ms`);
        console.log("====================================");

        return res.json({
            success: true,
            processingTime: `${elapsedMs.toFixed(2)} ms`,
            message: "ICT result saved."
        });

    } catch (err) {

        const endTime = process.hrtime.bigint();
        const elapsedMs = Number(endTime - startTime) / 1_000_000;

        console.error("❌ Error:", err.message);
        console.log(`⚡ Failed after: ${elapsedMs.toFixed(2)} ms`);

        return res.status(500).json({
            success: false,
            processingTime: `${elapsedMs.toFixed(2)} ms`,
            message: err.message
        });

    }
};