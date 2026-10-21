
import express from "express";
import { getProductionSummary } from "../controller/reports.controller.js";
import {getProductionOrderProgressController} from "../controller/productionOrderProgress.controller.js";


const router = express.Router();

router.get("/production-summary", getProductionSummary);
router.get("/production-order/:id/stage-progress", getProductionOrderProgressController);

export default router;
