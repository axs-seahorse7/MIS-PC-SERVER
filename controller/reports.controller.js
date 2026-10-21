
import { getProductionSummaryData } from "../services/reports.service.js";


export const getProductionSummary = async (req, res) => {
  try {
    const result = await getProductionSummaryData(
      req.user,
      req.query
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error("ERR IN GET PRODUCTION SUMMARY:", error);

    return res.status(error.status || 500).json({
      success: false,
      message:
        error.status === 403 || error.status === 404
          ? error.message
          : "Failed to fetch production summary",
    });
  }
};

