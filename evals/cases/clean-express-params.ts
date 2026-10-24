import express from "express";
import { Pool } from "pg";
import { z } from "zod";

const pool = new Pool();
const app = express();
const Params = z.object({ id: z.coerce.number().int().positive() });

app.get("/users/:id", async (req, res, next) => {
  try {
    const { id } = Params.parse(req.params);
    const result = await pool.query("SELECT id, name FROM users WHERE id = $1", [id]);
    res.json(result.rows[0] ?? null);
  } catch (err) {
    next(err);
  }
});

export default app;
