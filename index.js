const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const fs = require("fs");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// DB connection
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,      // Change to your DB user
  password: process.env.DB_PASSWORD,  // Change to your DB password
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,    // Change to your DB name
    ssl: {
      rejectUnauthorized: true,
      ca: fs.readFileSync('./certs/isrgrootx1.pem') // Optional: downloaded from TiDB Cloud
    }
});

// ✅ Reusable USSD Logic Function
async function handleUssd(sessionId, phoneNumber, text) {
  let response = "";
  const input = text.split("*").filter((x) => x !== "");
  const level = input.length;

  // Load session or create one
  let [rows] = await db.query("SELECT * FROM sessions WHERE sessionID = ?", [
    sessionId,
  ]);
  let session = rows[0];

  if (!session) {
    await db.query(
      "INSERT INTO sessions (sessionID, phoneNumber, userInput, language) VALUES (?, ?, ?, ?)",
      [sessionId, phoneNumber, "", null]
    );
    session = {
      sessionID: sessionId,
      phoneNumber,
      userInput: "",
      language: null,
    };
  }

  // === Level 0: Welcome ===
  if (text === "") {
    response = `CON Welcome / Murakaza neza\n1. English\n2. Kinyarwanda\n0. Exit`;
  }

  // === Language Selection ===
  else if (text === "1") {
    await db.query(
      "UPDATE sessions SET language = ?, userInput = ? WHERE sessionID = ?",
      ["en", text, sessionId]
    );
    response = `CON Main Menu:\n1. Check Balance\n2. Transfer Funds\n3. Buy Airtime\n4. View Transactions\n0. Back`;
  } else if (text === "2") {
    await db.query(
      "UPDATE sessions SET language = ?, userInput = ? WHERE sessionID = ?",
      ["rw", text, sessionId]
    );
    response = `CON Menyu Nyamukuru:\n1. Reba Saldo\n2. Ohereza Amafaranga\n3. Kugura Airtime\n4. Reba Amakuru y'Imikoreshereze\n0. Subira inyuma`;
  }

  // === Menu Flow ===
  else {
    const langRow = await db.query(
      "SELECT language FROM sessions WHERE sessionID = ?",
      [sessionId]
    );
    const lang = langRow[0][0]?.language;

    const menus = {
      en: [
        "Main Menu:\n1. Check Balance\n2. Transfer Funds\n3. Buy Airtime\n4. View Transactions\n0. Back",
        "Enter recipient's number:\n0. Back",
        "Enter amount to transfer:\n0. Back",
        "Enter amount to buy airtime:\n0. Back",
      ],
      rw: [
        "Menyu Nyamukuru:\n1. Reba Saldo\n2. Ohereza Amafaranga\n3. Kugura Airtime\n4. Reba Amakuru y'Imikoreshereze\n0. Subira inyuma",
        "Andika nimero y'uwo wohereza amafaranga:\n0. Subira inyuma",
        "Andika amafaranga wohereza:\n0. Subira inyuma",
        "Andika amafaranga ushaka kugura:\n0. Subira inyuma",
      ],
    };

    // English Flow
    if (lang === "en") {
      switch (true) {
        case /^1\*1$/.test(text):
          response = `END Your balance is RWF 10000`;
          break;
        case /^1\*2$/.test(text):
          response = `CON ${menus.en[1]}`;
          break;
        case /^1\*2\*\d{10,}$/.test(text):
          response = `CON ${menus.en[2]}`;
          break;
        case /^1\*2\*\d{10,}\*\d+$/.test(text): {
          const parts = text.split("*");
          const recipient = parts[2];
          const amount = parts[3];
          await db.query(
            "INSERT INTO transactions (sessionID, phoneNumber, action, amount) VALUES (?, ?, ?, ?)",
            [sessionId, phoneNumber, "Transfer", amount]
          );
          response = `END RWF ${amount} has been sent to ${recipient}`;
          break;
        }
        case /^1\*3$/.test(text):
          response = `CON ${menus.en[3]}`;
          break;
        case /^1\*3\*\d+$/.test(text): {
          const amount = text.split("*")[2];
          await db.query(
            "INSERT INTO transactions (sessionID, phoneNumber, action, amount) VALUES (?, ?, ?, ?)",
            [sessionId, phoneNumber, "Buy Airtime", amount]
          );
          response = `END You have bought airtime worth RWF ${amount}`;
          break;
        }
        case /^1\*4$/.test(text): {
          const [txns] = await db.query(
            "SELECT action, amount FROM transactions WHERE sessionID = ? ORDER BY timestamp DESC LIMIT 3",
            [sessionId]
          );
          if (txns.length === 0) {
            response = `END No transactions found`;
          } else {
            const msg = txns
              .map((t, i) => `${i + 1}. ${t.action} - RWF ${t.amount}`)
              .join("\n");
            response = `END Last 3 Transactions:\n${msg}`;
          }
          break;
        }
        case /^1$/.test(text):
          response = `CON ${menus.en[0]}`;
          break;
        case /^0$/.test(text):
          response = `END Session ended.`;
          break;
        default:
          response = `END Invalid input`;
      }
    }

    // Kinyarwanda Flow
    else if (lang === "rw") {
      switch (true) {
        case /^2\*1$/.test(text):
          response = `END Saldo yawe ni RWF 10000`;
          break;
        case /^2\*2$/.test(text):
          response = `CON ${menus.rw[1]}`;
          break;
        case /^2\*2\*\d{10,}$/.test(text):
          response = `CON ${menus.rw[2]}`;
          break;
        case /^2\*2\*\d{10,}\*\d+$/.test(text): {
          const parts = text.split("*");
          const recipient = parts[2];
          const amount = parts[3];
          await db.query(
            "INSERT INTO transactions (sessionID, phoneNumber, action, amount) VALUES (?, ?, ?, ?)",
            [sessionId, phoneNumber, "Ohereza Amafaranga", amount]
          );
          response = `END RWF ${amount} woherejwe kuri ${recipient}`;
          break;
        }
        case /^2\*3$/.test(text):
          response = `CON ${menus.rw[3]}`;
          break;
        case /^2\*3\*\d+$/.test(text): {
          const amount = text.split("*")[2];
          await db.query(
            "INSERT INTO transactions (sessionID, phoneNumber, action, amount) VALUES (?, ?, ?, ?)",
            [sessionId, phoneNumber, "Kugura Airtime", amount]
          );
          response = `END Waguze airtime ya RWF ${amount} neza`;
          break;
        }
        case /^2\*4$/.test(text): {
          const [txns] = await db.query(
            "SELECT action, amount FROM transactions WHERE sessionID = ? ORDER BY timestamp DESC LIMIT 3",
            [sessionId]
          );
          if (txns.length === 0) {
            response = `END Nta makuru y'imikoreshereze abonetse`;
          } else {
            const msg = txns
              .map((t, i) => `${i + 1}. ${t.action} - RWF ${t.amount}`)
              .join("\n");
            response = `END Imikoreshereze 3 iheruka:\n${msg}`;
          }
          break;
        }
        case /^2$/.test(text):
          response = `CON ${menus.rw[0]}`;
          break;
        case /^0$/.test(text):
          response = `END Ibiganiro birarangiye. Murakoze.`;
          break;
        default:
          response = `END Igisubizo ntikiboneke. Ongera ugerageze.`;
      }
    } else {
      response = `END Invalid session`;
    }
  }

  return response;
}

// ✅ Main route
app.post("/ussd", async (req, res) => {
  try {
    let { sessionId, phoneNumber, text } = req.body;
    const input = text.split("*").filter((x) => x !== "");
    const lastInput = input[input.length - 1];

    // Go back on 0
    if (lastInput === "0" && input.length > 0) {
      text = input.slice(0, -1).join("*");
    }

    const response = await handleUssd(sessionId, phoneNumber, text);
    res.set("Content-Type", "text/plain");
    res.send(response);
  } catch (error) {
    console.error("Error:", error);
    res.set("Content-Type", "text/plain");
    res.send("END An error occurred");
  }
});


app.listen(3000, () => {
  console.log("✅ USSD Bank App with Back option running on port 3000");
});

