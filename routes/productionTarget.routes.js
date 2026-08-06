// routes/productionTargetRoutes.js
import express from "express";
import {
  getProductionTargets,
  createProductionTarget,
  updateProductionTarget,
  deleteProductionTarget,
  getProductionTargetsByLineAndProduct,
} from "../controller/productionTarget.controller.js";

const router = express.Router();

router.get("/", getProductionTargets);
router.get("/by-line-and-product/:line_id/:product_id", getProductionTargetsByLineAndProduct);
router.post("/", createProductionTarget);
router.put("/:id", updateProductionTarget);
router.delete("/:id", deleteProductionTarget);

export default router;