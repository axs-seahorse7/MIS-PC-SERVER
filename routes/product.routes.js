import { createProducts, getProducts, updateProduct, deleteProduct } from "../controller/products.controller.js";
import e from "express";

const router = e.Router()

router.post("/create", createProducts)
router.put("/update/:id", updateProduct)
router.delete("/delete/:id", deleteProduct)


router.get("/all", getProducts)


export default router