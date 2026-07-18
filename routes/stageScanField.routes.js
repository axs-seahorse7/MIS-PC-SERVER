import express from "express";
import {createStageScanField, getStageScanFields, updateStageScanField, deleteStageScanField } from "../controller/stageScanField.controller.js";

const router = express.Router();

router.post("/create", createStageScanField);
router.get("/all", getStageScanFields);
router.put("/update/:id", updateStageScanField);
router.delete("/delete/:id", deleteStageScanField);


export default router;