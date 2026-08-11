import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "hamro-khata.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS parties (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,place TEXT DEFAULT '',phone TEXT DEFAULT '',opening_balance INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT,party_id INTEGER,type TEXT NOT NULL CHECK(type IN ('sale','payment','purchase','expense')),ref TEXT NOT NULL UNIQUE,date TEXT NOT NULL,particulars TEXT DEFAULT '',debit INTEGER NOT NULL DEFAULT 0,credit INTEGER NOT NULL DEFAULT 0,payment_mode TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(party_id) REFERENCES parties(id));
CREATE INDEX IF NOT EXISTS idx_transactions_party ON transactions(party_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE TABLE IF NOT EXISTS fiscal_years (id INTEGER PRIMARY KEY AUTOINCREMENT,label_bs TEXT NOT NULL UNIQUE,start_ad TEXT NOT NULL,end_ad TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS party_opening_balances (fiscal_year_id INTEGER NOT NULL,party_id INTEGER NOT NULL,amount INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(fiscal_year_id,party_id),FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years(id),FOREIGN KEY(party_id) REFERENCES parties(id));
CREATE TABLE IF NOT EXISTS voucher_sequences (fiscal_year_id INTEGER NOT NULL,voucher_type TEXT NOT NULL,last_number INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(fiscal_year_id,voucher_type),FOREIGN KEY(fiscal_year_id) REFERENCES fiscal_years(id));
`);
const transactionColumns = (
  db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[]
).map((c) => c.name);
if (!transactionColumns.includes("fiscal_year_id"))
  db.exec(
    "ALTER TABLE transactions ADD COLUMN fiscal_year_id INTEGER REFERENCES fiscal_years(id)",
  );
if (!transactionColumns.includes("sequence_no"))
  db.exec("ALTER TABLE transactions ADD COLUMN sequence_no INTEGER");
const count = db.prepare("SELECT COUNT(*) count FROM parties").get() as {
  count: number;
};
if (!count.count) {
  const seed = db.transaction(() => {
    const party = db.prepare(
      "INSERT INTO parties (name,place,opening_balance) VALUES (?,?,?)",
    );
    party.run("Tashi Delek Traders", "Phuentsholing", 1357500);
    party.run("Druk Hardware House", "Thimphu", 985400);
    party.run("Norbu Enterprise", "Paro", -124000);
    party.run("Karma General Store", "Gelephu", 171000);
    const tx = db.prepare(
      "INSERT INTO transactions (party_id,type,ref,date,particulars,debit,credit,payment_mode) VALUES (?,?,?,?,?,?,?,?)",
    );
    tx.run(
      1,
      "sale",
      "INV-2081",
      "2026-07-16",
      "Trading goods",
      485000,
      0,
      null,
    );
    tx.run(
      2,
      "payment",
      "REC-0942",
      "2026-07-16",
      "Part payment",
      0,
      200000,
      "Cash",
    );
    tx.run(
      null,
      "purchase",
      "PUR-0718",
      "2026-07-15",
      "Inventory purchase",
      0,
      326500,
      null,
    );
    tx.run(
      4,
      "sale",
      "INV-2080",
      "2026-07-15",
      "Trading goods",
      175800,
      0,
      null,
    );
    tx.run(
      null,
      "expense",
      "EXP-0137",
      "2026-07-14",
      "Internet expense",
      0,
      4800,
      "Bank",
    );
  });
  seed();
}
db.prepare(
  "INSERT OR IGNORE INTO fiscal_years(label_bs,start_ad,end_ad,status) VALUES (?,?,?,?)",
).run("2082/83", "2025-07-17", "2026-07-16", "closed");
db.prepare(
  "INSERT OR IGNORE INTO fiscal_years(label_bs,start_ad,end_ad,status) VALUES (?,?,?,?)",
).run("2083/84", "2026-07-17", "2027-07-16", "open");
const oldFy = (
  db.prepare("SELECT id FROM fiscal_years WHERE label_bs='2082/83'").get() as {
    id: number;
  }
).id;
const currentFy = (
  db.prepare("SELECT id FROM fiscal_years WHERE label_bs='2083/84'").get() as {
    id: number;
  }
).id;
db.prepare(
  "UPDATE transactions SET fiscal_year_id=? WHERE fiscal_year_id IS NULL AND date<=?",
).run(oldFy, "2026-07-16");
const openingCount = (
  db
    .prepare(
      "SELECT COUNT(*) count FROM party_opening_balances WHERE fiscal_year_id=?",
    )
    .get(currentFy) as { count: number }
).count;
if (!openingCount) {
  db.prepare(
    `INSERT INTO party_opening_balances(fiscal_year_id,party_id,amount)
    SELECT ?,p.id,p.opening_balance+COALESCE(SUM(t.debit-t.credit),0) FROM parties p LEFT JOIN transactions t ON t.party_id=p.id AND t.fiscal_year_id=? GROUP BY p.id`,
  ).run(currentFy, oldFy);
}
export default db;
