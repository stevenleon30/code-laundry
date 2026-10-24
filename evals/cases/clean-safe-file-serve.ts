import express from "express";
import path from "node:path";

const BASE = path.resolve("/srv/files");
const app = express();

app.get("/files/:name", (req, res) => {
  const target = path.resolve(BASE, path.basename(req.params.name));
  if (!target.startsWith(BASE + path.sep)) {
    res.status(400).send("bad path");
    return;
  }
  res.sendFile(target);
});

export default app;
