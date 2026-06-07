const { Router } = require("express");
const { pool } = require("../db");
const router = Router();

function generateSheetNo() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const r = String(Math.floor(Math.random() * 90000) + 10000);
  return `BT${y}${m}${d}${r}`;
}

async function calculateSubsidy(caseId) {
  const [[caseInfo]] = await pool.execute(
    `SELECT c.id, c.case_type, c.lawyer_id, c.start_date, c.status, cs.case_no, cs.result
     FROM cases c 
     WHERE c.id = ?`,
    [caseId],
  );
  if (!caseInfo) {
    throw new Error("案件不存在");
  }
  if (caseInfo.status !== "已结案") {
    throw new Error("只有已结案的案件才能生成补贴核算单");
  }
  if (!caseInfo.lawyer_id) {
    throw new Error("案件未指派律师，无法生成补贴");
  }

  const [[std]] = await pool.execute(
    "SELECT amount FROM subsidy_standards WHERE case_type = ?",
    [caseInfo.case_type],
  );
  if (!std) {
    throw new Error("未找到对应的补贴标准");
  }

  let isOverdue = 0;
  let actualAmount = std.amount;

  if (caseInfo.start_date) {
    const start = new Date(caseInfo.start_date);
    const end = new Date();
    const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if (diffDays > 90) {
      isOverdue = 1;
      actualAmount = std.amount * 1.3;
    }
  }

  return {
    case_id: caseInfo.id,
    case_type: caseInfo.case_type,
    lawyer_id: caseInfo.lawyer_id,
    standard_amount: std.amount,
    is_overdue: isOverdue,
    actual_amount: actualAmount,
  };
}

router.post("/generate/:caseId", async (req, res) => {
  const { caseId } = req.params;
  try {
    const [[existing]] = await pool.execute(
      "SELECT id FROM subsidy_sheets WHERE case_id = ?",
      [caseId],
    );
    if (existing) {
      return res.status(400).json({ error: "该案件已生成补贴核算单" });
    }

    const subsidyData = await calculateSubsidy(caseId);
    const sheetNo = generateSheetNo();
    const today = new Date().toISOString().split("T")[0];

    const [result] = await pool.execute(
      `INSERT INTO subsidy_sheets 
       (sheet_no, case_id, case_type, lawyer_id, standard_amount, is_overdue, actual_amount, status, calculate_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, '待确认', ?)`,
      [
        sheetNo,
        subsidyData.case_id,
        subsidyData.case_type,
        subsidyData.lawyer_id,
        subsidyData.standard_amount,
        subsidyData.is_overdue,
        subsidyData.actual_amount,
        today,
      ],
    );

    res.status(201).json({
      id: result.insertId,
      sheet_no: sheetNo,
      message: "补贴核算单生成成功",
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/", async (req, res) => {
  const {
    status,
    case_type,
    lawyer_id,
    start_date,
    end_date,
    page = 1,
    size = 20,
  } = req.query;
  let conditions = [];
  let params = [];

  if (status) {
    conditions.push("s.status = ?");
    params.push(status);
  }
  if (case_type) {
    conditions.push("s.case_type = ?");
    params.push(case_type);
  }
  if (lawyer_id) {
    conditions.push("s.lawyer_id = ?");
    params.push(lawyer_id);
  }
  if (start_date) {
    conditions.push("s.calculate_date >= ?");
    params.push(start_date);
  }
  if (end_date) {
    conditions.push("s.calculate_date <= ?");
    params.push(end_date);
  }

  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) as total FROM subsidy_sheets s${where}`,
    params,
  );

  const limit = parseInt(size);
  const offset = (parseInt(page) - 1) * limit;

  const [data] = await pool.query(
    `
    SELECT s.*, c.case_no, l.name as lawyer_name, l.firm as lawyer_firm
    FROM subsidy_sheets s 
    LEFT JOIN cases c ON s.case_id = c.id
    LEFT JOIN lawyers l ON s.lawyer_id = l.id
    ${where}
    ORDER BY s.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `,
    params,
  );

  res.json({ total, page: parseInt(page), size: limit, data });
});

router.get("/:id", async (req, res) => {
  const [[row]] = await pool.query(
    `
    SELECT s.*, c.case_no, c.description as case_desc, c.result as case_result,
           l.name as lawyer_name, l.license_no as lawyer_license, l.phone as lawyer_phone, l.firm as lawyer_firm
    FROM subsidy_sheets s 
    LEFT JOIN cases c ON s.case_id = c.id
    LEFT JOIN lawyers l ON s.lawyer_id = l.id
    WHERE s.id = ?
  `,
    [req.params.id],
  );
  if (!row) return res.status(404).json({ error: "补贴核算单不存在" });
  res.json(row);
});

router.put("/:id/confirm", async (req, res) => {
  const { id } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[sheet]] = await conn.execute(
      "SELECT * FROM subsidy_sheets WHERE id = ? FOR UPDATE",
      [id],
    );
    if (!sheet) {
      await conn.rollback();
      return res.status(404).json({ error: "补贴核算单不存在" });
    }
    if (sheet.status !== "待确认") {
      await conn.rollback();
      return res.status(400).json({ error: "只有待确认状态的核算单可以确认" });
    }

    const year = new Date().getFullYear();
    const [[budget]] = await conn.execute(
      "SELECT * FROM annual_budgets WHERE year = ? FOR UPDATE",
      [year],
    );
    if (!budget) {
      await conn.rollback();
      return res.status(400).json({ error: "本年度预算未设置" });
    }

    const totalBudget = parseFloat(budget.total_budget);
    const usedAmount = parseFloat(budget.used_amount);
    const actualAmount = parseFloat(sheet.actual_amount);

    const remaining = totalBudget - usedAmount;
    if (remaining < actualAmount) {
      await conn.rollback();
      return res.status(400).json({
        error: "预算不足，无法确认",
        remaining: remaining,
        required: actualAmount,
      });
    }

    const usageRate = (usedAmount + actualAmount) / totalBudget;
    const warning = usageRate > 0.8;

    const today = new Date().toISOString().split("T")[0];
    await conn.execute(
      "UPDATE subsidy_sheets SET status = '已确认', confirm_date = ? WHERE id = ?",
      [today, id],
    );

    await conn.execute(
      "UPDATE annual_budgets SET used_amount = used_amount + ? WHERE id = ?",
      [sheet.actual_amount, budget.id],
    );

    await conn.commit();
    res.json({
      message: "核算单确认成功",
      warning,
      usage_rate: parseFloat(usageRate.toFixed(4)),
    });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

router.put("/:id/issue", async (req, res) => {
  const { id } = req.params;
  const { issue_method, bank_serial_no, issue_date } = req.body;

  if (!issue_method || !["银行转账", "现金"].includes(issue_method)) {
    return res.status(400).json({ error: "请选择有效的发放方式" });
  }
  if (issue_method === "银行转账" && !bank_serial_no) {
    return res.status(400).json({ error: "银行转账必须填写银行流水号" });
  }

  const [[sheet]] = await pool.execute(
    "SELECT status FROM subsidy_sheets WHERE id = ?",
    [id],
  );
  if (!sheet) return res.status(404).json({ error: "补贴核算单不存在" });
  if (sheet.status !== "已确认") {
    return res.status(400).json({ error: "只有已确认状态的核算单可以发放" });
  }

  const issueDate = issue_date || new Date().toISOString().split("T")[0];
  await pool.execute(
    `UPDATE subsidy_sheets 
     SET status = '已发放', issue_date = ?, issue_method = ?, bank_serial_no = ?
     WHERE id = ?`,
    [issueDate, issue_method, bank_serial_no || null, id],
  );

  res.json({ message: "补贴发放成功" });
});

router.get("/lawyer/:lawyerId/records", async (req, res) => {
  const { lawyerId } = req.params;
  const { year, page = 1, size = 20 } = req.query;

  let conditions = ["s.lawyer_id = ?", "s.status = '已发放'"];
  let params = [lawyerId];

  if (year) {
    conditions.push("YEAR(s.issue_date) = ?");
    params.push(year);
  }

  const where = " WHERE " + conditions.join(" AND ");
  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) as total FROM subsidy_sheets s${where}`,
    params,
  );

  const limit = parseInt(size);
  const offset = (parseInt(page) - 1) * limit;

  const [data] = await pool.query(
    `
    SELECT s.*, c.case_no, c.case_type
    FROM subsidy_sheets s 
    LEFT JOIN cases c ON s.case_id = c.id
    ${where}
    ORDER BY s.issue_date DESC
    LIMIT ${limit} OFFSET ${offset}
  `,
    params,
  );

  const [[{ total_income }]] = await pool.execute(
    `SELECT COALESCE(SUM(actual_amount), 0) as total_income FROM subsidy_sheets s${where}`,
    params,
  );

  res.json({
    total,
    page: parseInt(page),
    size: limit,
    total_income: parseFloat(total_income),
    data,
  });
});

module.exports = router;
