import express from "express";
import fs from "node:fs";

const app = express();

app.get("/download", (req, res) => {
  const data = fs.readFileSync("/srv/files/" + req.query.name);
  res.send(data);
});

export default app;
