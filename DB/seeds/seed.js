import mysql from "mysql2/promise";
import bcrypt from "bcrypt";
import dotenv from "dotenv";

dotenv.config();

const DB_NAME = process.env.DB_NAME || "pcb_mis";

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "pcb_user",
  password: process.env.DB_PASSWORD,
  database: DB_NAME,
};

const seedAdmin = async () => {
  let connection;

  try {
    console.log("🔌 Connecting to MySQL...");

    connection = await mysql.createConnection(dbConfig);

    console.log(`📂 Using database: ${DB_NAME}`);

    const username = process.env.ADMIN_USERNAME;
    const name = process.env.ADMIN_NAME;
    const email = process.env.ADMIN_EMAIL || null;
    const password = process.env.ADMIN_PASSWORD;

    if (!username || !name || !password) {
      throw new Error(
        "ADMIN_USERNAME, ADMIN_NAME and ADMIN_PASSWORD must be defined in .env"
      );
    }

    // Check whether admin already exists
    const [existingUsers] = await connection.query(
      "SELECT id, username, role FROM users WHERE username = ? LIMIT 1",
      [username]
    );

    if (existingUsers.length > 0) {
      console.log(
        `⏭️ User '${username}' already exists. Seed skipped.`
      );
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create SYSTEM_ADMIN
    await connection.query(
      `
      INSERT INTO users (
        username,
        password,
        name,
        email,
        role,
        is_active
      )
      VALUES (?, ?, ?, ?, 'SYSTEM_ADMIN', 1)
      `,
      [
        username,
        hashedPassword,
        name,
        email,
      ]
    );

    console.log(`✅ SYSTEM_ADMIN '${username}' created successfully`);

  } catch (error) {
    console.error("❌ Seed failed:", error.message);
    process.exitCode = 1;

  } finally {
    if (connection) {
      await connection.end();
    }
  }
};

seedAdmin();