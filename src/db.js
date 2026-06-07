const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "3306"),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "legal123",
  database: process.env.DB_NAME || "legal_aid",
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10,
});

async function initDb() {
  const conn = await pool.getConnection();
  try {
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS applicants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        id_card VARCHAR(18) NOT NULL UNIQUE,
        gender ENUM('男','女') NOT NULL,
        phone VARCHAR(20),
        address VARCHAR(200),
        category ENUM('低保户','残疾人','老年人','未成年人','农民工','军人军属','其他') NOT NULL,
        income_level ENUM('无收入','低收入','一般'),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS lawyers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        license_no VARCHAR(30) NOT NULL UNIQUE,
        phone VARCHAR(20),
        firm VARCHAR(100) NOT NULL,
        speciality VARCHAR(50),
        status ENUM('可接案','案件中','休假') NOT NULL DEFAULT '可接案',
        case_count INT DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS cases (
        id INT AUTO_INCREMENT PRIMARY KEY,
        case_no VARCHAR(20) NOT NULL UNIQUE,
        applicant_id INT NOT NULL,
        lawyer_id INT,
        case_type ENUM('民事','刑事','行政','劳动争议','婚姻家庭','其他') NOT NULL,
        description TEXT,
        status ENUM('待审批','已批准','已指派','办理中','已结案','已驳回') NOT NULL DEFAULT '待审批',
        approve_reason VARCHAR(500),
        reject_reason VARCHAR(500),
        result TEXT,
        start_date DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (applicant_id) REFERENCES applicants(id),
        FOREIGN KEY (lawyer_id) REFERENCES lawyers(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [caseCols] = await conn.execute("DESCRIBE cases");
    const hasStartDate = caseCols.some((c) => c.Field === "start_date");
    if (!hasStartDate) {
      await conn.execute("ALTER TABLE cases ADD COLUMN start_date DATE");
    }

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS subsidy_standards (
        id INT AUTO_INCREMENT PRIMARY KEY,
        case_type ENUM('民事','刑事','行政','劳动争议','婚姻家庭','其他') NOT NULL UNIQUE,
        amount DECIMAL(10,2) NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [[stdCount]] = await conn.execute(
      "SELECT COUNT(*) as cnt FROM subsidy_standards",
    );
    if (stdCount.cnt === 0) {
      await conn.execute(`
        INSERT INTO subsidy_standards (case_type, amount) VALUES
        ('民事', 1500.00),
        ('刑事', 2000.00),
        ('行政', 1500.00),
        ('劳动争议', 1200.00),
        ('婚姻家庭', 1000.00),
        ('其他', 1000.00)
      `);
    }

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS subsidy_sheets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sheet_no VARCHAR(30) NOT NULL UNIQUE,
        case_id INT NOT NULL,
        case_type ENUM('民事','刑事','行政','劳动争议','婚姻家庭','其他') NOT NULL,
        lawyer_id INT NOT NULL,
        standard_amount DECIMAL(10,2) NOT NULL,
        is_overdue TINYINT(1) DEFAULT 0,
        actual_amount DECIMAL(10,2) NOT NULL,
        status ENUM('待确认','已确认','已发放') NOT NULL DEFAULT '待确认',
        calculate_date DATE NOT NULL,
        confirm_date DATE,
        issue_date DATE,
        issue_method ENUM('银行转账','现金'),
        bank_serial_no VARCHAR(100),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (case_id) REFERENCES cases(id),
        FOREIGN KEY (lawyer_id) REFERENCES lawyers(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS annual_budgets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        year INT NOT NULL UNIQUE,
        total_budget DECIMAL(12,2) NOT NULL,
        used_amount DECIMAL(12,2) DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log("数据库表初始化完成");
  } finally {
    conn.release();
  }
}

module.exports = { pool, initDb };
