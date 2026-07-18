import pool from "../DB/config/mysql.config.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

// createUser
export const createUser = async (req, res) => {
  try {
    const { username, password, name, email, role, factory_id, line_id, stage_id } = req.body;

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      `INSERT INTO users (username, password, name, email, role, factory_id, line_id, stage_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [username, hashedPassword, name, email, role, factory_id || null, line_id || null, stage_id || null]
    );

    return res.status(201).json({
      success: true,
      userId: result.insertId,
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { username, password } = req.body;

    const [rows] = await pool.query("SELECT * FROM users WHERE username = ?", [username]);

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "USER NOT FOUND",
      });
    }

    const user = rows[0];

    const isPasswordValid = await bcrypt.compare(
      password,
      user.password
    );

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || "7d",
      }
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      token,
      success: true,
      message: "Login successful",
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        stage_id: user.stage_id,
      },
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

export const getMe = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [user.id]);

    return res.status(200).json({
      success: true,
      user: rows[0],
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Something went wrong" });
  }

};

export const logout = (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });

  return res.status(200).json({ success: true, message: "Logged out successfully" });
};


// getUsers
export const getUsers = async (req, res) => {
  try {
    const [users] = await pool.query(`
      SELECT
        u.id,
        u.username,
        u.name,
        u.email,
        u.role,
        u.factory_id,
        f.name AS factory_name,
        u.line_id,
        pl.name AS line_name,
        u.stage_id,
        s.name AS stage_name,
        u.is_active,
        u.created_at
      FROM users u
      LEFT JOIN factories f ON f.id = u.factory_id
      LEFT JOIN production_lines pl ON pl.id = u.line_id
      LEFT JOIN stages s ON s.id = u.stage_id
      ORDER BY u.id DESC
    `);

    return res.status(200).json(users);
  } catch (error) {
    console.log("ERR IN GET USERS:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;

    // updateUser — just extend allowedFields
    const allowedFields = [
      "username",
      "name",
      "email",
      "role",
      "factory_id",
      "line_id",
      "stage_id",
      "is_active",
    ];

    const fields = [];
    const values = [];

    for (const key in req.body) {
      if (allowedFields.includes(key)) {
        fields.push(`${key} = ?`);
        values.push(req.body[key]);
      }
    }

    if (!fields.length) {
      return res.status(400).json({
        message: "No fields to update",
      });
    }

    values.push(id);

    const [result] = await pool.query(
      `
      UPDATE users
      SET ${fields.join(", ")}
      WHERE id = ?
      `,
      values
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return res.status(200).json({
      message: "User updated successfully",
    });
  } catch (error) {
    console.log("ERR IN UPDATE USER:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const changePassword = async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    const hashedPassword = await bcrypt.hash(
      password,
      10
    );

    await pool.query(
      `
      UPDATE users
      SET password = ?
      WHERE id = ?
      `,
      [hashedPassword, id]
    );

    return res.status(200).json({
      message: "Password updated successfully",
    });
  } catch (error) {
    console.log(
      "ERR IN CHANGE PASSWORD:",
      error
    );

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const deleteUser = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      `
      UPDATE users
      SET is_active = 0
      WHERE id = ?
      `,
      [id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    return res.status(200).json({
      message: "User deactivated successfully",
    });
  } catch (error) {
    console.log("ERR IN DELETE USER:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};