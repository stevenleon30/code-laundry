import express from "express";
import { Pool } from "pg";

const pool = new Pool();
const app = express();

app.get("/users", async (req, res) => {
  const result = await pool.query(`SELECT * FROM users WHERE id = ${req.query.id}`);
  res.json(result.rows);
});

export default app;
