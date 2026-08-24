import express from "express";
import { createProductStageFlow, getProductStageFlows, getProductFlowByProductId, updateProductStageFlow, deleteProductStageFlow, reorderProductStageFlow } from "../controller/productStageFlow.controller.js";

const router = express.Router();

router.post("/create", createProductStageFlow);
router.get("/all", getProductStageFlows);
router.get("/:productId", getProductFlowByProductId);
router.put("/update/:id", updateProductStageFlow);
router.delete("/delete/:id", deleteProductStageFlow);
router.patch("/reorder", reorderProductStageFlow);


export default router;