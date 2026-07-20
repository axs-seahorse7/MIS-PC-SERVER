import { createProducts, getProducts, getProductsByCategory, updateProduct, deleteProduct } from "../controller/products.controller.js";
import e from "express";

const router = e.Router()

router.post("/create", createProducts)
router.put("/update/:id", updateProduct)
router.delete("/delete/:id", deleteProduct)


router.get("/all", getProducts)
router.get("/by-category/:categoryId", getProductsByCategory)

export default router