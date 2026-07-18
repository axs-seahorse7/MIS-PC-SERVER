import {createProductField, getProductFieldById, getProductFields, getProductFieldsByProduct, updateProductField, deleteProductField} from "../controller/productionField.controller.js";
import express from "express";

const router = express.Router();

router.post("/create", createProductField);

router.get("/all", getProductFields);

router.get("/:productId", getProductFieldsByProduct);

router.get("/:id", getProductFieldById);

router.put("/:id", updateProductField);

router.delete("/:id", deleteProductField);

export default router;