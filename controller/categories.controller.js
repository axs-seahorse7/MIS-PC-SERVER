import {pool} from "../DB/config/mysql.config.js";


export const createCategory = async (req, res) => {    
    try {
        const { name, description } = req.body;

        const [result] = await pool.query(
            `INSERT INTO categories (name, description) VALUES (?, ?)`,
            [name, description]
        );

        return res.status(201).json({
            success: true,
            categoryId: result.insertId,
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: err.message,
        });
    }
};

export const updateCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description } = req.body;

        const [result] = await pool.query(
            `UPDATE categories SET name = ?, description = ? WHERE id = ?`,
            [name, description, id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Category not found",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Category updated successfully",
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: err.message,
        });
    }
};

export const deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.query("SELECT * FROM categories WHERE id = ?", [id]);

        if(rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Category not found",
            });
        }

        if(rows[0].is_default) {
            return res.status(400).json({
                success: false,
                message: "Default categories cannot be deleted",
            });
        }
        
        const [result] = await pool.query("DELETE FROM categories WHERE id = ?", [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Category not found",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Category deleted successfully",
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: err.message,
        });
    }
};

export const getAllCategories = async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT * FROM categories");
        return res.status(200).json({
            success: true,
            categories: rows,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            success: false,
            message: err.message,
        });
    }
};


