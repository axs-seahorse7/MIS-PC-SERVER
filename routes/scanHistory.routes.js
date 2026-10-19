import express from "express";
import { createGroup, submitScan, getTenLatestScans} from "../controller/scanHistory.controller.js";
import {
  closePartialBox,
  getOpenPartialBoxes,
} from "../controller/partialBoxClosure.controller.js";

const router = express.Router();

router.post("/create",  submitScan);
router.post("/create-group", createGroup);
router.get("/latest-scans/:factory_id/:product_id/:line_id/:stage_id/:production_order_id", getTenLatestScans);

router.get("/open-partial-boxes", getOpenPartialBoxes);
router.post("/close-partial-box", closePartialBox);

export default router;