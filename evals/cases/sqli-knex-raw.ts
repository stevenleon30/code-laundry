import express from "express";
import knex from "knex";

const db = knex({ client: "pg" });
const app = express();

app.get("/orders/:id", async (req, res) => {
  const rows = await db.raw("SELECT * FROM orders WHERE id = " + req.params.id);
  res.json(rows);
});

export default app;
