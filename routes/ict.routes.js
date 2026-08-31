import express from "express";
import {saveICTResult} from "../controller/ict.controller.js";

const router = express.Router();

console.log("====================================");
console.log("------------- REQ CAME INTO ICT ROUTE ----------------------");
console.log("====================================");
router.post("/save/result", saveICTResult);

export default router;