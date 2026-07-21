import express from "express";
import { createGroup, submitScan} from "../controller/scanHistory.controller.js";

const router = express.Router();

router.post("/create", submitScan);
router.post("/create-group", createGroup);

export default router;