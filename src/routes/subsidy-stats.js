const { Router } = require("express");
const { pool } = require("../db");
const router = Router();

router.get("/monthly-expense", async (req, res) => {
  const { year } = req.query;
  const y = year || new Date().getFullYear();

  const [data] = await pool.execute(
    `SELECT 
       DATE_FORMAT(issue_date, '%Y-%m') as month,
       COUNT(*) as count,
       SUM(actual_amount) as total_amount
     FROM subsidy_sheets 
     WHERE status = '已发放' AND YEAR(issue_date) = ?
     GROUP BY DATE_FORMAT(issue_date, '%Y-%m')
     ORDER BY month`,
    [y],
  );

  res.json({ year: parseInt(y), data });
});

router.get("/lawyer-ranking", async (req, res) => {
  const { year, top } = req.query;
  const y = year || new Date().getFullYear();
  const limit = top ? parseInt(top) : 10;

  const [data] = await pool.query(
    `SELECT 
       l.id,
       l.name,
       l.firm,
       COUNT(s.id) as case_count,
       SUM(s.actual_amount) as total_income
     FROM subsidy_sheets s
     LEFT JOIN lawyers l ON s.lawyer_id = l.id
     WHERE s.status = '已发放' AND YEAR(s.issue_date) = ?
     GROUP BY s.lawyer_id, l.id, l.name, l.firm
     ORDER BY total_income DESC
     LIMIT ?`,
    [y, limit],
  );

  res.json({ year: parseInt(y), data });
});

router.get("/case-type-stats", async (req, res) => {
  const { year } = req.query;
  const y = year || new Date().getFullYear();

  const [data] = await pool.execute(
    `SELECT 
       case_type,
       COUNT(*) as count,
       SUM(actual_amount) as total_amount
     FROM subsidy_sheets 
     WHERE status = '已发放' AND YEAR(issue_date) = ?
     GROUP BY case_type
     ORDER BY total_amount DESC`,
    [y],
  );

  res.json({ year: parseInt(y), data });
});

router.get("/budget-execution", async (req, res) => {
  const { year } = req.query;
  const y = year || new Date().getFullYear();

  const [[budget]] = await pool.execute(
    "SELECT * FROM annual_budgets WHERE year = ?",
    [y],
  );

  if (!budget) {
    return res.status(404).json({ error: "该年度预算未设置" });
  }

  const totalBudget = parseFloat(budget.total_budget);
  const usedAmount = parseFloat(budget.used_amount);
  const remaining = totalBudget - usedAmount;
  const executionRate = totalBudget > 0 ? usedAmount / totalBudget : 0;
  const warning = executionRate > 0.8;

  const [[confirmedCount]] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM subsidy_sheets 
     WHERE status IN ('已确认', '已发放') AND YEAR(confirm_date) = ?`,
    [y],
  );

  const [[issuedCount]] = await pool.execute(
    `SELECT COUNT(*) as cnt FROM subsidy_sheets 
     WHERE status = '已发放' AND YEAR(issue_date) = ?`,
    [y],
  );

  res.json({
    year: parseInt(y),
    total_budget: totalBudget,
    used_amount: usedAmount,
    remaining: remaining,
    execution_rate: parseFloat(executionRate.toFixed(4)),
    warning,
    confirmed_count: confirmedCount.cnt,
    issued_count: issuedCount.cnt,
  });
});

router.get("/overview", async (req, res) => {
  const currentYear = new Date().getFullYear();

  const [[budget]] = await pool.execute(
    "SELECT * FROM annual_budgets WHERE year = ?",
    [currentYear],
  );

  const [[pendingCount]] = await pool.execute(
    "SELECT COUNT(*) as cnt FROM subsidy_sheets WHERE status = '待确认'",
  );
  const [[confirmedCount]] = await pool.execute(
    "SELECT COUNT(*) as cnt FROM subsidy_sheets WHERE status = '已确认'",
  );
  const [[issuedCount]] = await pool.execute(
    "SELECT COUNT(*) as cnt FROM subsidy_sheets WHERE status = '已发放'",
  );

  const [[totalIssuedAmount]] = await pool.execute(
    "SELECT COALESCE(SUM(actual_amount), 0) as total FROM subsidy_sheets WHERE status = '已发放'",
  );

  res.json({
    year: currentYear,
    budget: budget
      ? {
          total_budget: parseFloat(budget.total_budget),
          used_amount: parseFloat(budget.used_amount),
          remaining:
            parseFloat(budget.total_budget) - parseFloat(budget.used_amount),
          usage_rate:
            budget.total_budget > 0
              ? parseFloat(
                  (
                    parseFloat(budget.used_amount) /
                    parseFloat(budget.total_budget)
                  ).toFixed(4),
                )
              : 0,
          warning:
            budget.total_budget > 0
              ? parseFloat(budget.used_amount) /
                  parseFloat(budget.total_budget) >
                0.8
              : false,
        }
      : null,
    sheet_stats: {
      pending: pendingCount.cnt,
      confirmed: confirmedCount.cnt,
      issued: issuedCount.cnt,
      total_issued_amount: parseFloat(totalIssuedAmount.total),
    },
  });
});

module.exports = router;
