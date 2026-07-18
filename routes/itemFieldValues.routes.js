import express from "express";
import {createItemFieldValue, getItemFieldValues, getItemFieldValuesByItem,  updateItemFieldValue, deleteItemFieldValue} from "../controller/itemFieldValues.controller.js";

const router = express.Router();

router.post("/create", createItemFieldValue);
router.get("/all", getItemFieldValues);
router.get("/item/:itemId", getItemFieldValuesByItem);
router.put("/:id", updateItemFieldValue);
router.delete("/:id", deleteItemFieldValue);

export default router;