import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

// Toutes les valeurs viennent des variables d'environnement.
// Rien n'est en dur : en local on lit .env, en prod ce sera injecté
// par Ansible / GitHub Secrets (cf. TP DevOps section 3.3).
const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "todo_app",
});

pool.on("error", (err) => {
  console.error("Erreur inattendue sur le pool PostgreSQL :", err);
});

export default pool;
