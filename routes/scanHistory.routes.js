import express from "express";
import { createScanHistory, submitScan} from "../controller/scanHistory.controller.js";

const router = express.Router();

router.post("/create", submitScan);


export default router;