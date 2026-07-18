import {createFctResult, getFctResults} from "../controller/fct.controller.js";
import express from "express";

const router = express.Router();

router.post("/create", createFctResult);
router.get("/results", getFctResults);

export default router;