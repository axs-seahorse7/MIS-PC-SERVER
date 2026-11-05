import { getDashboardOverview as getDashboardOverviewData } from "../../services/dashboard/overview.service.js";
import { getHourlyProductionData } from "../../services/dashboard/hourlyProduction.service.js";

export const getDashboardOverview = async (req, res) => {
  try {
    const data = await getDashboardOverviewData(req.user, req.query);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("DASHBOARD OVERVIEW ERROR:", error);

    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to fetch dashboard overview",
    });
  }
};

export const getHourlyProduction = async (req, res) => {
  try {
    const data = await getHourlyProductionData(req.user, req.query);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("DASHBOARD HOURLY PRODUCTION ERROR:", error);

    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to fetch hourly production",
    });
  }
};