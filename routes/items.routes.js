import { Router } from "express";
import { createItem, getItems, getItemById, updateItem, deleteItem } from "../controller/items.controller.js";

const router = Router();

router.post("/create", createItem);
router.get("/all", getItems);
router.get("/:id", getItemById);
router.put("/:id", updateItem);
router.delete("/:id", deleteItem);

export default router;