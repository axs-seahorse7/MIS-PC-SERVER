import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsPath = path.join(
  __dirname,
  "..",
  "DB",
  "migrations"
);

const DB_NAME = process.env.DB_NAME || "pcb_mis";

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "pcb_user",
  password: process.env.DB_PASSWORD,
};

const runMigrations = async () => {
  let connection;

  try {
    // ---------------------------------------------------------
    // 1. Connect to MySQL server WITHOUT selecting a database
    // ---------------------------------------------------------

    console.log("🔌 Connecting to MySQL server...");

    const serverConnection = await mysql.createConnection(dbConfig);

    console.log("✅ MySQL server connected");

    // ---------------------------------------------------------
    // 2. Create database if it doesn't exist
    // ---------------------------------------------------------

    await serverConnection.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`
       CHARACTER SET utf8mb4
       COLLATE utf8mb4_0900_ai_ci`
    );

    console.log(`✅ Database ready: ${DB_NAME}`);

    await serverConnection.end();

    // ---------------------------------------------------------
    // 3. NOW connect WITH the database selected
    // ---------------------------------------------------------

    connection = await mysql.createConnection({
      ...dbConfig,
      database: DB_NAME,
      multipleStatements: true,
    });

    console.log(`📂 Using database: ${DB_NAME}`);

    // ---------------------------------------------------------
    // 4. Create migration tracking table
    // ---------------------------------------------------------

    await connection.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        migration VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("✅ Migration tracking table ready");

    // ---------------------------------------------------------
    // 5. Read migration files
    // ---------------------------------------------------------

    const files = await fs.readdir(migrationsPath);

    const migrationFiles = files
      .filter((file) => file.endsWith(".sql"))
      .sort();

    if (migrationFiles.length === 0) {
      console.log("ℹ️ No migration files found");
      return;
    }

    // ---------------------------------------------------------
    // 6. Get already executed migrations
    // ---------------------------------------------------------

    const [executedRows] = await connection.query(
      "SELECT migration FROM migrations"
    );

    const executedMigrations = new Set(
      executedRows.map((row) => row.migration)
    );

    // ---------------------------------------------------------
    // 7. Run pending migrations
    // ---------------------------------------------------------

    for (const file of migrationFiles) {

      if (executedMigrations.has(file)) {
        console.log(`⏭️ Already executed: ${file}`);
        continue;
      }

      console.log(`🚀 Running: ${file}`);

      const sql = await fs.readFile(
        path.join(migrationsPath, file),
        "utf8"
      );

      try {
        await connection.beginTransaction();

        await connection.query(sql);

        await connection.query(
          "INSERT INTO migrations (migration) VALUES (?)",
          [file]
        );

        await connection.commit();

        console.log(`✅ Completed: ${file}`);

      } catch (error) {

        await connection.rollback();

        console.error(`❌ Failed: ${file}`);
        console.error(error.message);

        throw error;
      }
    }

    console.log("🎉 Database migration completed successfully");

  } catch (error) {

    console.error("❌ Migration failed:", error.message);
    process.exitCode = 1;

  } finally {

    if (connection) {
      await connection.end();
    }
  }
};

runMigrations();