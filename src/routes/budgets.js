const { Router } = require("express");
const { pool } = require("../db");
const router = Router();

router.post("/", async (req, res) => {
  const { year, total_budget } = req.body;
  if (!year || !total_budget) {
    return res.status(400).json({ error: "年份和总预算为必填" });
  }
  if (isNaN(total_budget) || total_budget <= 0) {
    return res.status(400).json({ error: "预算金额必须为正数" });
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO annual_budgets (year, total_budget) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE total_budget = VALUES(total_budget)`,
      [year, parseFloat(total_budget).toFixed(2)],
    );
    res.status(201).json({ message: "年度预算设置成功" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/", async (req, res) => {
  const [data] = await pool.execute(
    "SELECT * FROM annual_budgets ORDER BY year DESC",
  );
  res.json(data);
});

router.get("/:year", async (req, res) => {
  const { year } = req.params;
  const [[row]] = await pool.execute(
    "SELECT * FROM annual_budgets WHERE year = ?",
    [year],
  );
  if (!row) {
    return res.status(404).json({ error: "该年度预算未设置" });
  }

  const totalBudget = parseFloat(row.total_budget);
  const usedAmount = parseFloat(row.used_amount);
  const remaining = totalBudget - usedAmount;
  const usageRate = totalBudget > 0 ? usedAmount / totalBudget : 0;
  const warning = usageRate > 0.8;

  res.json({
    id: row.id,
    year: row.year,
    total_budget: totalBudget,
    used_amount: usedAmount,
    remaining: remaining,
    usage_rate: parseFloat(usageRate.toFixed(4)),
    warning,
  });
});

router.put("/:year", async (req, res) => {
  const { year } = req.params;
  const { total_budget } = req.body;
  if (!total_budget || isNaN(total_budget)) {
    return res.status(400).json({ error: "请输入有效的预算金额" });
  }

  const [[budgetRow]] = await pool.execute(
    "SELECT * FROM annual_budgets WHERE year = ?",
    [year],
  );
  if (!budgetRow) {
    return res.status(404).json({ error: "该年度预算未设置" });
  }

  const usedAmount = parseFloat(budgetRow.used_amount);
  if (parseFloat(total_budget) < usedAmount) {
    return res.status(400).json({ error: "新预算不能小于已使用金额" });
  }

  const [result] = await pool.execute(
    "UPDATE annual_budgets SET total_budget = ? WHERE year = ?",
    [parseFloat(total_budget).toFixed(2), year],
  );
  if (result.affectedRows === 0) {
    return res.status(404).json({ error: "该年度预算未设置" });
  }
  res.json({ message: "年度预算更新成功" });
});

router.get("/progress/current", async (req, res) => {
  const currentYear = new Date().getFullYear();
  const [[budget]] = await pool.execute(
    "SELECT * FROM annual_budgets WHERE year = ?",
    [currentYear],
  );

  if (!budget) {
    return res.status(404).json({ error: "本年度预算未设置" });
  }

  const totalBudget = parseFloat(budget.total_budget);
  const usedAmount = parseFloat(budget.used_amount);
  const remaining = totalBudget - usedAmount;
  const usageRate = totalBudget > 0 ? usedAmount / totalBudget : 0;
  const warning = usageRate > 0.8;

  res.json({
    year: currentYear,
    total_budget: totalBudget,
    used_amount: usedAmount,
    remaining: remaining,
    usage_rate: parseFloat(usageRate.toFixed(4)),
    warning,
  });
});

module.exports = router;
