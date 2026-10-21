
import { getProductionOrderProgress } from "../services/productionOrderProgress.service.js";

export const getProductionOrderProgressController = async (req, res) => {
  try {
    const result = await getProductionOrderProgress(
      req.user,
      Number(req.params.id)
    );

    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to load production order progress",
    });
  }
};
