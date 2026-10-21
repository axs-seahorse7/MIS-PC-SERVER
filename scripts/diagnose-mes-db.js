
import { pool } from "../DB/config/mysql.config.js";

async function run() {
  try {
    const checks = [
      ["Stage and machine columns", `
        SHOW COLUMNS FROM stages
      `],
      ["Production scan records", `
        SHOW COLUMNS FROM production
      `],
      ["ICT result columns", `
        SHOW COLUMNS FROM ict_results
      `],
      ["FCT result columns", `
        SHOW COLUMNS FROM fct_results
      `],
      ["External result columns", `
        SHOW COLUMNS FROM external_results
      `],
      ["Box relationships", `
        SHOW CREATE TABLE box_items
      `],
    ];

    for (const [label, sql] of checks) {
      console.log(`\n=== ${label} ===`);
      const [rows] = await pool.query(sql);
      console.table(rows);
    }

    console.log("\n=== Stage names and machine codes ===");
    const [stages] = await pool.query(`
      SELECT id, name, machine_code
      FROM stages
      ORDER BY id
    `);
    console.table(stages);

    console.log("\n=== Production status counts ===");
    const [production] = await pool.query(`
      SELECT status, COUNT(*) AS total
      FROM production
      GROUP BY status
    `);
    console.table(production);

    console.log("\n=== Diagnostic completed ===");
  } catch (error) {
    console.error("Diagnostic failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
