const { Router } = require("express");
const { pool } = require("../db");
const router = Router();

router.get("/", async (req, res) => {
  const [data] = await pool.execute(
    "SELECT * FROM subsidy_standards ORDER BY id",
  );
  res.json(data);
});

router.get("/:case_type", async (req, res) => {
  const { case_type } = req.params;
  const [[row]] = await pool.execute(
    "SELECT * FROM subsidy_standards WHERE case_type = ?",
    [case_type],
  );
  if (!row) return res.status(404).json({ error: "补贴标准不存在" });
  res.json(row);
});

router.put("/:case_type", async (req, res) => {
  const { case_type } = req.params;
  const { amount } = req.body;
  if (!amount || isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: "补贴金额必须为正数" });
  }
  const [result] = await pool.execute(
    "UPDATE subsidy_standards SET amount = ? WHERE case_type = ?",
    [parseFloat(amount).toFixed(2), case_type],
  );
  if (result.affectedRows === 0) {
    return res.status(404).json({ error: "补贴标准不存在" });
  }
  res.json({ message: "补贴标准更新成功" });
});

router.post("/batch", async (req, res) => {
  const { standards } = req.body;
  if (!Array.isArray(standards) || standards.length === 0) {
    return res.status(400).json({ error: "标准列表不能为空" });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const std of standards) {
      if (!std.case_type || !std.amount || std.amount <= 0) {
        await conn.rollback();
        return res.status(400).json({ error: "标准数据不完整或金额无效" });
      }
      await conn.execute(
        "UPDATE subsidy_standards SET amount = ? WHERE case_type = ?",
        [parseFloat(std.amount).toFixed(2), std.case_type],
      );
    }
    await conn.commit();
    res.json({ message: "批量更新成功" });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
