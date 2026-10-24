import express from "express";

const app = express();

app.get("/hello", (req, res) => {
  res.send(`<h1>Hello ${req.query.name}</h1>`);
});

export default app;
