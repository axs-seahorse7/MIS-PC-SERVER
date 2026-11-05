import { getDashboardOverview } from "../../services/dashboard/overview.service.js";

export const getOverview = async (req, res) => {
  try {
    const result = await getDashboardOverview(
      req.user,
      req.query
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error("DASHBOARD OVERVIEW ERROR:", error);

    return res.status(error.status || 500).json({
      success: false,
      message:
        error.status && error.status < 500
          ? error.message
          : "Unable to load dashboard overview.",
    });
  }
};