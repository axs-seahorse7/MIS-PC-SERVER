import {pool} from "../DB/config/mysql.config.js"


export const createProducts = async (req, res) => {
    try {
        const { categoryId, name, description, remarks } = req.body;

        const [result] = await pool.query(
            `INSERT INTO products (category_id, name, description, remarks)
             VALUES (?, ?, ?, ?)`,
            [categoryId, name, description, remarks]
        );

        return res.status(201).json({
            message: "Product created successfully",
            id: result.insertId
        });
    } catch (error) {
        console.log("ERR IN CREATE PRODUCT:", error);
        return res.status(500).json({
            message: error.message
        });
    }
};

export const updateProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const { categoryId, name, description, remarks } = req.body;

        const [result] = await pool.query(
            `UPDATE products SET category_id = ?, name = ?, description = ?, remarks = ? WHERE id = ?`,
            [categoryId, name, description, remarks, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: "Product not found"
            });
        }

        return res.status(200).json({
            message: "Product updated successfully"
        });
    } catch (error) {
        console.log("ERR IN UPDATE PRODUCT:", error);
        return res.status(500).json({
            message: error.message
        });
    }
};

export const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;

        const [result] = await pool.query(
            `DELETE FROM products WHERE id = ?`,
            [id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: "Product not found"
            });
        }

        return res.status(200).json({
            message: "Product deleted successfully"
        });
    }
    catch (error) {
        console.log("ERR IN DELETE PRODUCT:", error);
        return res.status(500).json({
            message: error.message
        });
    }
};


export const getProducts = async (req, res) => {
    try {
        const [result] = await pool.query(`SELECT * FROM products`);

        return res.status(200).json(result);
    } catch (error) {
        console.log("ERR IN GET PRODUCTS:", error);
        return res.status(500).json({ message: error.message });
    }
};