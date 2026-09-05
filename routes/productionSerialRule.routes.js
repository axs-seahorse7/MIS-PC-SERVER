import express from "express";

import {
  getAllProductionSerialRules,
  getProductionSerialRuleById,
  createProductionSerialRule,
  updateProductionSerialRule,
  patchProductionSerialRule,
  deleteProductionSerialRule,
} from "../controller/productionSerialRule.controller.js";

const router = express.Router();

router.get("/all", getAllProductionSerialRules);
router.get("/:id", getProductionSerialRuleById);
router.post("/create", createProductionSerialRule);
router.put("/update/:id", updateProductionSerialRule);
router.patch("/patch/:id", patchProductionSerialRule);
router.delete("/delete/:id", deleteProductionSerialRule);

export default router;