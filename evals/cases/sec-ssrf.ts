import express from "express";
import axios from "axios";

const app = express();

app.get("/preview", async (req, res) => {
  const response = await axios.get(req.query.url as string);
  res.send(response.data);
});

export default app;
