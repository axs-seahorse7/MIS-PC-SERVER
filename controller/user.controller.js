import pool from "../DB/config/mysql.config.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

export const createUser = async (req, res) => {
  try {
    const {username, password, name, email, role, stage_id } = req.body;

    const hashedPassword =
      await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      `INSERT INTO users (username, password, name, email, role, stage_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [username, hashedPassword, name, email, role, stage_id,]
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

    return res.status(200).json({
      success: true,
      user,
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


