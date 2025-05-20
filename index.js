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

// USSD logic


app.post("/ussd", async (req, res) => {
  let { sessionId, phoneNumber, text } = req.body;
  let response = "";

  const input = text.split("*").filter(x => x !== "");
  const level = input.length;
  const lastInput = input[input.length - 1];

  try {
    // Get or initialize session
    let [rows] = await db.query("SELECT * FROM sessions WHERE sessionID = ?", [sessionId]);
    let session = rows[0];

    if (!session) {
      await db.query("INSERT INTO sessions (sessionID, phoneNumber, userInput, language) VALUES (?, ?, ?, ?)", [sessionId, phoneNumber, "", null]);
      session = { sessionID: sessionId, phoneNumber, userInput: "", language: null };
    }

    // === Handle 0 (Back) ===
    if (lastInput === "0" && level > 0) {
      const previousInput = input.slice(0, -1).join("*");
      req.body.text = previousInput;
      // Re-run the logic with updated text
      return app._router.handle(req, res, () => {});
    }

    // === Level 0: Welcome ===
    if (text === "") {
      response = `CON Welcome / Karibu\n1. English\n2. Kiswahili\n0. Exit`;
    }

    // === Language Selection ===
    else if (text === "1") {
      await db.query("UPDATE sessions SET language = ?, userInput = ? WHERE sessionID = ?", ["en", text, sessionId]);
      response = `CON Main Menu:\n1. Check Balance\n2. Transfer Funds\n3. Buy Airtime\n4. View Transactions\n0. Back`;
    } else if (text === "2") {
      await db.query("UPDATE sessions SET language = ?, userInput = ? WHERE sessionID = ?", ["sw", text, sessionId]);
      response = `CON Menu Kuu:\n1. Angalia Salio\n2. Tuma Pesa\n3. Nunua Airtime\n4. Tazama Miamala\n0. Rudi`;
    }

    // === Main Menus and Submenus ===
    else {
      const langRow = await db.query("SELECT language FROM sessions WHERE sessionID = ?", [sessionId]);
      const lang = langRow[0][0]?.language;

      // Helper for menu text
      const menus = {
        en: [
          "Main Menu:\n1. Check Balance\n2. Transfer Funds\n3. Buy Airtime\n4. View Transactions\n0. Back",
          "Enter recipient's number:\n0. Back",
          "Enter amount to transfer:\n0. Back",
          "Enter amount to buy airtime:\n0. Back"
        ],
        sw: [
          "Menu Kuu:\n1. Angalia Salio\n2. Tuma Pesa\n3. Nunua Airtime\n4. Tazama Miamala\n0. Rudi",
          "Weka nambari ya mpokeaji:\n0. Rudi",
          "Weka kiasi cha kutuma:\n0. Rudi",
          "Weka kiasi cha airtime:\n0. Rudi"
        ]
      };

      if (lang === "en") {
        // English Flow
        switch (true) {
          case /^1\*1$/.test(text):
            response = `END Your balance is KES 10,000`;
            break;
          case /^1\*2$/.test(text):
            response = `CON ${menus.en[1]}`;
            break;
          case /^1\*2\*\d{10,}$/.test(text): // Accept any phone number
            response = `CON ${menus.en[2]}`;
            break;
          case /^1\*2\*\d{10,}\*\d+$/.test(text): // Accept any phone and amount
            {
              const parts = text.split("*");
              const recipient = parts[2];
              const amount = parts[3];
              await db.query("INSERT INTO transactions (sessionID, phoneNumber, action, amount, recipient) VALUES (?, ?, ?, ?, ?)", [sessionId, phoneNumber, "Transfer", amount, recipient]);
              response = `END KES ${amount} has been sent to ${recipient}`;
            }
            break;
          case /^1\*3$/.test(text):
            response = `CON ${menus.en[3]}`;
            break;
          case /^1\*3\*\d+$/.test(text): // Any amount
            {
              const amount = text.split("*")[2];
              await db.query("INSERT INTO transactions (sessionID, phoneNumber, action, amount) VALUES (?, ?, ?, ?)", [sessionId, phoneNumber, "Buy Airtime", amount]);
              response = `END You have bought KES ${amount} airtime`;
            }
            break;
          case /^1\*4$/.test(text):
            {
              const [txns] = await db.query("SELECT action, amount, recipient FROM transactions WHERE sessionID = ? ORDER BY timestamp DESC LIMIT 3", [sessionId]);
              if (txns.length === 0) {
                response = `END No transactions found`;
              } else {
                const msg = txns.map((t, i) => `${i + 1}. ${t.action} - KES ${t.amount}${t.recipient ? " to " + t.recipient : ""}`).join("\n");
                response = `END Last 3 Transactions:\n${msg}`;
              }
            }
            break;
          case /^1$/.test(text):
            response = `CON ${menus.en[0]}`;
            break;
          case /^0$/.test(text):
            response = `END Session ended.`;
            break;
          default:
            response = `END Invalid input`;
        }
      } else if (lang === "sw") {
        // Swahili Flow
        switch (true) {
          case /^2\*1$/.test(text):
            response = `END Salio lako ni KES 10,000`;
            break;
          case /^2\*2$/.test(text):
            response = `CON ${menus.sw[1]}`;
            break;
          case /^2\*2\*\d{10,}$/.test(text):
            response = `CON ${menus.sw[2]}`;
            break;
          case /^2\*2\*\d{10,}\*\d+$/.test(text):
            {
              const parts = text.split("*");
              const recipient = parts[2];
              const amount = parts[3];
              await db.query("INSERT INTO transactions (sessionID, phoneNumber, action, amount, recipient) VALUES (?, ?, ?, ?, ?)", [sessionId, phoneNumber, "Tuma Pesa", amount, recipient]);
              response = `END KES ${amount} imetumwa kwa ${recipient}`;
            }
            break;
          case /^2\*3$/.test(text):
            response = `CON ${menus.sw[3]}`;
            break;
          case /^2\*3\*\d+$/.test(text):
            {
              const amount = text.split("*")[2];
              await db.query("INSERT INTO transactions (sessionID, phoneNumber, action, amount) VALUES (?, ?, ?, ?)", [sessionId, phoneNumber, "Nunua Airtime", amount]);
              response = `END Umenunua KES ${amount} airtime`;
            }
            break;
          case /^2\*4$/.test(text):
            {
              const [txns] = await db.query("SELECT action, amount, recipient FROM transactions WHERE sessionID = ? ORDER BY timestamp DESC LIMIT 3", [sessionId]);
              if (txns.length === 0) {
                response = `END Hakuna miamala`;
              } else {
                const msg = txns.map((t, i) => `${i + 1}. ${t.action} - KES ${t.amount}${t.recipient ? " kwa " + t.recipient : ""}`).join("\n");
                response = `END Miamala 3 ya mwisho:\n${msg}`;
              }
            }
            break;
          case /^2$/.test(text):
            response = `CON ${menus.sw[0]}`;
            break;
          case /^0$/.test(text):
            response = `END Session imeisha.`;
            break;
          default:
            response = `END Chaguo si sahihi`;
        }
      } else {
        response = `END Invalid session`;
      }
    }

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

