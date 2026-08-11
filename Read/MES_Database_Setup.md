# MES PCB Server — Database Setup

This document explains how to initialize the MySQL database for the MES PCB Server project on a fresh development or deployment machine.

## Database Architecture

The project uses:

- MySQL
- `mysql2/promise`
- SQL migration files
- A Node.js migration runner
- A Node.js seed script for the initial system administrator

The database is separated into three concepts:

```text
Migrations
    ↓
Database structure

Seeds
    ↓
Required initial data

Application
    ↓
Admin configures the remaining MES data
```

## Project Structure

```text
MIS-PCB-SERVER/
│
├── DB/
│   ├── config/
│   │   └── db.js
│   │
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   │
│   └── seeds/
│       └── seed.js
│
├── scripts/
│   └── migrate.js
│
├── controller/
├── middleware/
├── models/
├── routes/
├── service/
├── utils/
│
├── .env
├── .env.example
├── .gitignore
└── package.json
```

## 1. Environment Configuration

Create a `.env` file in the project root.

Example:

```env
DB_HOST=localhost
DB_USER=pcb_user
DB_PASSWORD=your_database_password
DB_NAME=pcb_mis

ADMIN_USERNAME=admin
ADMIN_NAME=System Administrator
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your_admin_password
```

### Important

Never commit `.env` to Git.

Commit only `.env.example` with placeholder values.

Example `.env.example`:

```env
DB_HOST=localhost
DB_USER=pcb_user
DB_PASSWORD=
DB_NAME=pcb_mis

ADMIN_USERNAME=admin
ADMIN_NAME=System Administrator
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=
```

## 2. Install Dependencies

After cloning the repository:

```bash
npm install
```

## 3. Run Database Migrations

Run:

```bash
npm run migrate
```

The migration runner will:

1. Connect to the MySQL server.
2. Create the database specified by `DB_NAME` if it does not exist.
3. Connect to that database.
4. Create the `migrations` tracking table.
5. Read SQL files from `DB/migrations/`.
6. Execute pending migrations in filename order.
7. Record successfully executed migrations.

The initial migration:

```text
DB/migrations/001_initial_schema.sql
```

creates the complete MES database structure, including the application's 27 tables.

### Migration tracking

The system creates:

```text
migrations
```

with:

```text
id
migration
executed_at
```

Example:

```text
1 | 001_initial_schema.sql | 2026-08-11 ...
```

If the migration has already been executed, running:

```bash
npm run migrate
```

again will skip it.

Example:

```text
⏭️ Already executed: 001_initial_schema.sql
```

## 4. Run the Initial Seed

After migration:

```bash
npm run seed
```

The seed script creates only the initial `SYSTEM_ADMIN` account.

The password is taken from:

```env
ADMIN_PASSWORD=...
```

and is hashed using bcrypt before being stored.

The seed does not copy the existing development users, factories, products, stages, printers, production targets, scan history, or other production data.

If the administrator already exists, the seed is skipped:

```text
⏭️ User 'admin' already exists. Seed skipped.
```

## 5. Complete Fresh Installation

For a completely new environment:

```bash
npm install
npm run migrate
npm run seed
npm run dev
```

The resulting flow is:

```text
Clone repository
      ↓
npm install
      ↓
npm run migrate
      ↓
Database created
      ↓
27 MES tables created
      ↓
npm run seed
      ↓
SYSTEM_ADMIN created
      ↓
Admin logs in
      ↓
Admin configures MES
```

## 6. What Is NOT Seeded

The repository does not automatically seed environment-specific or operational data such as:

- Factories
- Production lines
- Products
- Product fields
- Product stage flows
- Stage scan configuration
- Printers
- Packaging configuration
- Production targets
- Production records
- Scan history
- ICT results
- FCT results
- Items
- Item groups
- Scan groups
- Boxes
- Box items
- Box print jobs
- Existing development users

This is intentional.

After installation, the `SYSTEM_ADMIN` configures the required MES environment through the application.

## 7. Creating Future Migrations

Once `001_initial_schema.sql` has been deployed, do not edit it.

For a future schema change, create a new migration.

Example:

```text
DB/migrations/
├── 001_initial_schema.sql
└── 002_add_machine_name_to_scan_history.sql
```

Example:

```sql
ALTER TABLE scan_history
ADD COLUMN machine_name VARCHAR(255) NULL;
```

Then run:

```bash
npm run migrate
```

The migration runner will detect and execute only the new migration.

## 8. Migration Rules

### Do

- Give migrations sequential names.
- Commit migration files to Git.
- Keep migrations small and focused.
- Test new migrations on a fresh/test database.
- Run `npm run migrate` after pulling new migrations.

### Do not

- Edit an already-deployed migration.
- Delete migration history.
- Commit production data.
- Commit `.env`.
- Put real production passwords in seed files.
- Manually change the production schema without creating a migration.

## 9. Recommended Git Ignore

Your `.gitignore` should contain:

```gitignore
.env
.env.*
!.env.example

node_modules/
```

## 10. Development Database Testing

Before releasing a new database migration, test it against a clean database.

Example:

```sql
DROP DATABASE IF EXISTS pcb_mis_migration_test;

CREATE DATABASE pcb_mis_migration_test;
```

Temporarily set:

```env
DB_NAME=pcb_mis_migration_test
```

Then:

```bash
npm run migrate
npm run seed
```

Verify that:

- The database is created.
- All 27 tables are created.
- The `migrations` table exists.
- `001_initial_schema.sql` is recorded.
- The `SYSTEM_ADMIN` is created.
- Running `npm run migrate` a second time skips the completed migration.
- Running `npm run seed` a second time does not create a duplicate administrator.
- The application starts successfully.

After testing, restore the normal database name in `.env`.

## Database Initialization Commands

### New installation

```bash
npm install
npm run migrate
npm run seed
npm run dev
```

### Existing installation with new migrations

```bash
npm run migrate
```

### Re-run seed safely

```bash
npm run seed
```

The seed script is designed to skip the administrator if it already exists.

---

## Summary

The project now follows this principle:

```text
001_initial_schema.sql
        ↓
    DB STRUCTURE

      +

seed.js
        ↓
 SYSTEM ADMIN

      +

Admin configuration
        ↓
 FACTORIES
 PRODUCTS
 STAGES
 LINES
 MACHINES
 PRINTERS
 ETC.
```

This keeps the Git repository portable while preventing company-specific production configuration and operational data from being automatically installed on every machine.
