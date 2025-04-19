require("dotenv").config();
const express = require("express");
const app = express();
const analyzeRouter = require("./controllers/analyzeController");

app.use(express.json());
app.use("/analyze", analyzeRouter);

const PORT = process.env.PORT || 4002;
app.listen(PORT, () => {
  console.log(`🚀 IA service running on port ${PORT}`);
});
