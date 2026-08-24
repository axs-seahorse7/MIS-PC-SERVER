import e from "express";
import {createProductionOrder, updateProductionOrder, startProductionOrder, pauseProductionOrder, resumeProductionOrder, getProductionOrders, getProductionOrderById, cancelProductionOrder, deleteProductionOrder} from "../controller/productionOrderController.js";

const router = e.Router();

router.post("/create", createProductionOrder);

router.get("/all", getProductionOrders);
router.get("/:id", getProductionOrderById);
router.put("/:id/update", updateProductionOrder);
router.patch("/:id/cancel", cancelProductionOrder);
router.patch("/:id/start", startProductionOrder);
router.patch("/:id/pause", pauseProductionOrder);
router.patch("/:id/resume", resumeProductionOrder);
router.delete("/:id", deleteProductionOrder);

export default router;