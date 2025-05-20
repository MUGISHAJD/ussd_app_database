const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// DB connection
const db = mysql.createPool({
  host: "localhost",
  user: "root",      // Change to your DB user
  password: "",  // Change to your DB password
  database: "ussd_app"     // Change to your DB name
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
      return app._router.handle(req, res, () => {});
    }

    // === Level 0: Welcome ===
    if (text === "") {
      response = `CON Welcome / Karibu\n1. English\n2. Kiswahili`;
    }

    // === Language Selection ===
    else if (text === "1") {
      await db.query("UPDATE sessions SET language = ?, userInput = ? WHERE sessionID = ?", ["en", text, sessionId]);
      response = `CON Main Menu:\n1. Check Balance\n2. Transfer Funds\n3. Buy Airtime\n4. View Transactions\n0. Back`;
    } else if (text === "2") {
      await db.query("UPDATE sessions SET language = ?, userInput = ? WHERE sessionID = ?", ["sw", text, sessionId]);
      response = `CON Menu Kuu:\n1. Angalia Salio\n2. Tuma Pesa\n3. Nunua Airtime\n4. Tazama Miamala\n0. Rudi`;
    }

    // === Main Menus ===
    else {
      const langRow = await db.query("SELECT language FROM sessions WHERE sessionID = ?", [sessionId]);
      const lang = langRow[0][0]?.language;

      if (lang === "en") {
        // English Flow
        switch (text) {
          case "1*1":
            response = `END Your balance is KES 10,000`;
            break;
          case "1*2":
            response = `CON Enter recipient's number:\n0. Back`;
            break;
          case "1*2*0712345678":
            response = `CON Enter amount to transfer:\n0. Back`;
            break;
          case "1*2*0712345678*500":
            await db.query("INSERT INTO transactions (sessionID, phoneNumber, action, amount) VALUES (?, ?, ?, ?)", [sessionId, phoneNumber, "Transfer", 500]);
            response = `END KES 500 has been sent to 0712345678`;
            break;
          case "1*3":
            response = `CON Enter amount to buy airtime:\n0. Back`;
            break;
          case "1*3*100":
            await db.query("INSERT INTO transactions (sessionID, phoneNumber, action, amount) VALUES (?, ?, ?, ?)", [sessionId, phoneNumber, "Buy Airtime", 100]);
            response = `END You have bought KES 100 airtime`;
            break;
          case "1*4":
            const [txns] = await db.query("SELECT action, amount FROM transactions WHERE sessionID = ? ORDER BY timestamp DESC LIMIT 3", [sessionId]);
            if (txns.length === 0) {
              response = `END No transactions found`;
            } else {
              const msg = txns.map((t, i) => `${i + 1}. ${t.action} - KES ${t.amount}`).join("\n");
              response = `END Last 3 Transactions:\n${msg}`;
            }
            break;
          default:
            response = `END Invalid input`;
        }
      } else if (lang === "sw") {
        // Swahili Flow
        switch (text) {
          case "2*1":
            response = `END Salio lako ni KES 10,000`;
            break;
          case "2*2":
            response = `CON Weka nambari ya mpokeaji:\n0. Rudi`;
            break;
          case "2*2*0712345678":
            response = `CON Weka kiasi cha kutuma:\n0. Rudi`;
            break;
          case "2*2*0712345678*500":
            await db.query("INSERT INTO transactions (sessionID, phoneNumber, action, amount) VALUES (?, ?, ?, ?)", [sessionId, phoneNumber, "Tuma Pesa", 500]);
            response = `END KES 500 imetumwa kwa 0712345678`;
            break;
          case "2*3":
            response = `CON Weka kiasi cha airtime:\n0. Rudi`;
            break;
          case "2*3*100":
            await db.query("INSERT INTO transactions (sessionID, phoneNumber, action, amount) VALUES (?, ?, ?, ?)", [sessionId, phoneNumber, "Nunua Airtime", 100]);
            response = `END Umenunua KES 100 airtime`;
            break;
          case "2*4":
            const [txns] = await db.query("SELECT action, amount FROM transactions WHERE sessionID = ? ORDER BY timestamp DESC LIMIT 3", [sessionId]);
            if (txns.length === 0) {
              response = `END Hakuna miamala`;
            } else {
              const msg = txns.map((t, i) => `${i + 1}. ${t.action} - KES ${t.amount}`).join("\n");
              response = `END Miamala 3 ya mwisho:\n${msg}`;
            }
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

