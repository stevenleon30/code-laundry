import express from "express";
import helmet from "helmet";
import mysql from "mysql2/promise";

const pool = mysql.createPool({ uri: process.env.DATABASE_URL });
const app = express();
app.use(helmet());

app.get("/products/:id", async (req, res, next) => {
  try {
    const [rows] = await pool.execute("SELECT id, name, price FROM products WHERE id = ?", [req.params.id]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default app;
