import express from "express";
import { createScanHistory, getScanHistory, getItemScanHistory, getStageScanHistory } from "../controller/stageHistory.controller.js";

const router = express.Router();

router.post("/create", createScanHistory);

router.get("/all", getScanHistory);

router.get("/item/:itemId",getItemScanHistory);

router.get("/stage/:stageId",getStageScanHistory);

export default router;