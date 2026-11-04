
import express from "express";

import {
  getReworkStations,
  createReworkStation,
  startRework,
  completeRework,
  rejectProduct,
  getQualityHistory,
} from "../controller/quality.controller.js";

const router = express.Router();

router.get("/stations", getReworkStations);
router.post("/stations", createReworkStation);

router.post("/rework/start", startRework);
router.post("/rework/complete", completeRework);

router.post("/reject", rejectProduct);

router.get("/history/:serialNo", getQualityHistory);

export default router;
