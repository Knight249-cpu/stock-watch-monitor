import { hash } from "bcryptjs";
import mysql from "mysql2/promise";

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function requireValue(name, value) {
  if (!value) {
    throw new Error(`Missing required value: ${name}`);
  }
  return value;
}

const email = requireValue("--email", getArg("--email") ?? process.env.ADMIN_EMAIL)?.trim().toLowerCase();
const password = requireValue("--password", getArg("--password") ?? process.env.ADMIN_PASSWORD);
const name = (getArg("--name") ?? process.env.ADMIN_NAME ?? "Administrator").trim();
const databaseUrl = requireValue("DATABASE_URL", process.env.DATABASE_URL);

const connection = await mysql.createConnection(databaseUrl);

try {
  const passwordHash = await hash(password, 12);
  const [existingRows] = await connection.execute(
    "SELECT id FROM users WHERE email = ? LIMIT 1",
    [email]
  );

  const existing = Array.isArray(existingRows) ? existingRows[0] : null;

  if (existing?.id) {
    await connection.execute(
      "UPDATE users SET name = ?, passwordHash = ?, role = 'admin', isActive = 1 WHERE id = ?",
      [name, passwordHash, existing.id]
    );
    console.log(`Updated admin account: ${email}`);
  } else {
    await connection.execute(
      "INSERT INTO users (name, email, passwordHash, role, isActive, createdByAdminId, createdAt, updatedAt, lastSignedIn) VALUES (?, ?, ?, 'admin', 1, NULL, NOW(), NOW(), NOW())",
      [name, email, passwordHash]
    );
    console.log(`Created admin account: ${email}`);
  }
} finally {
  await connection.end();
}
