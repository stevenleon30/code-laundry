import express from "express";
import mysql from "mysql2/promise";

const app = express();
app.use(express.json());

app.post("/login", async (req, res) => {
  const conn = await mysql.createConnection({ host: "db", user: "app", database: "app" });
  const [rows] = await conn.execute(
    `SELECT id FROM accounts WHERE username = '${req.body.username}' AND password = '${req.body.password}'`,
  );
  res.json(rows);
});

export default app;
