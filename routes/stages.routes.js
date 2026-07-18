import express from "express";
import { createStage, getStages, getStageById, updateStage, deleteStage } from "../controller/stages.controller.js";

const router = express.Router();


router.post("/create", createStage);
router.get("/all", getStages);
router.get("/get/:id", getStageById);
router.put("/update/:id", updateStage);
router.delete("/delete/:id", deleteStage);


export default router;