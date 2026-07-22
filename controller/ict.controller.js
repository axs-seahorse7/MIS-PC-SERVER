import { pool } from "../DB/config/mysql.config.js";

export const saveICTResult = async (req, res) => {

    const startTime = process.hrtime.bigint();

    try {

        const {
            serialNo,
            program,
            result,
            machineName
        } = req.body;

        console.log("====================================");
        console.log("📥 ICT Result Received");
        console.log({
            serialNo,
            program,
            result,
            machineName
        });

        const [resultRows] = await pool.query(
            "INSERT INTO ict_results (serial_no, program, result, machine_name) VALUES (?, ?, ?, ?)",
            [serialNo, program, result, machineName]
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