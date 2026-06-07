const express = require("express");
const cors = require("cors");
const { initDb } = require("./db");
const applicantRoutes = require("./routes/applicants");
const caseRoutes = require("./routes/cases");
const lawyerRoutes = require("./routes/lawyers");
const subsidyStandardRoutes = require("./routes/subsidy-standards");
const subsidySheetRoutes = require("./routes/subsidy-sheets");
const budgetRoutes = require("./routes/budgets");
const subsidyStatsRoutes = require("./routes/subsidy-stats");

const app = express();
const PORT = process.env.PORT || 7290;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ service: "法律援助管理平台", version: "1.0.0" });
});

app.use("/api/applicants", applicantRoutes);
app.use("/api/cases", caseRoutes);
app.use("/api/lawyers", lawyerRoutes);
app.use("/api/subsidy-standards", subsidyStandardRoutes);
app.use("/api/subsidy-sheets", subsidySheetRoutes);
app.use("/api/budgets", budgetRoutes);
app.use("/api/subsidy-stats", subsidyStatsRoutes);

async function start() {
  await initDb();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`法律援助平台启动成功，端口: ${PORT}`);
  });
}

start().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
