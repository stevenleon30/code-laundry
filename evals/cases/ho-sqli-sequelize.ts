import express from "express";
import { Sequelize, QueryTypes } from "sequelize";

const sequelize = new Sequelize(process.env.DATABASE_URL ?? "");
const app = express();
app.use(express.json());

app.post("/search", async (req, res) => {
  const rows = await sequelize.query(`SELECT * FROM items WHERE title LIKE '%${req.body.q}%'`, {
    type: QueryTypes.SELECT,
  });
  res.json(rows);
});

export default app;
