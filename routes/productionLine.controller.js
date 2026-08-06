// routes/productionLine.routes.js
import express from "express";
import {
  getAllProductionLines,
  getProductionLineById,
  createProductionLine,
  updateProductionLine,
  deleteProductionLine,
  getLinesByFactoryId,
} from "../controller/productionLine.controller.js";

const router = express.Router();

router.get("/all", getAllProductionLines);
router.get("/:id", getProductionLineById);
router.get("/by-factory/:factoryId", getLinesByFactoryId);

router.post("/create", createProductionLine);
router.put("/update/:id", updateProductionLine);
router.delete("/delete/:id", deleteProductionLine);
export default router;