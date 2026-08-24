import express from "express";
import { createGroup, submitScan, getTenLatestScans} from "../controller/scanHistory.controller.js";

const router = express.Router();

router.post("/create",  submitScan);
router.post("/create-group", createGroup);
router.get("/latest-scans/:factory_id/:product_id/:line_id/:stage_id",
  getTenLatestScans
);

export default router;