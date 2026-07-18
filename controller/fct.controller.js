import {pool} from "../DB/config/mysql.config.js";

export const createFctResult = async (req, res) => {
    try {
        const {
            lineCode,
            moLotNo,
            rail,
            snCode,
            stationCode,
            surface,
            results
        } = req.body;

        if (!lineCode || !moLotNo || !snCode || !stationCode || !results) {
            return res.status(400).json({
                message: "Missing required fields."
            });
        }

        const query = `
            INSERT INTO fct_results
            (line_code, mo_lot_no, rail, sn_code, station_code, surface, results)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        const [dbResult] = await pool.query(query, [
            lineCode,
            moLotNo,
            rail,
            snCode,
            stationCode,
            surface,
            JSON.stringify(results)
        ]);

        return res.status(201).json({
            message: "FCT result created successfully",
            id: dbResult.insertId
        });

    } catch (error) {
        console.error("Error creating FCT result:", error);

        return res.status(500).json({
            message: "Internal server error",
            error: error.message
        });
    }
};

export const getFctResults = async (req, res) => {
    try {
        const { lineCode, moLotNo, snCode, stationCode } = req.query;

        let query = "SELECT * FROM fct_results WHERE 1=1";
        const params = [];

        if (lineCode) {
            query += " AND line_code = ?";
            params.push(lineCode);
        }
        if (moLotNo) {
            query += " AND mo_lot_no = ?";
            params.push(moLotNo);
        }
        if (snCode) {
            query += " AND sn_code = ?";
            params.push(snCode);
        }
        if (stationCode) {
            query += " AND station_code = ?";
            params.push(stationCode);
        }

        const [results] = await pool.query(query, params);

        return res.status(200).json({
            message: "FCT results fetched successfully",
            data: results
        });
    } catch (error) {
        console.error("Error fetching FCT results:", error);
        return res.status(500).json({
            message: "Internal server error",
            error: error.message
        });
    }
};
