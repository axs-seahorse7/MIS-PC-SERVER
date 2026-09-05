import express from "express";
import {saveICTResult} from "../controller/ict.controller.js";

const router = express.Router();

router.post("/save/result", saveICTResult);

export default router;