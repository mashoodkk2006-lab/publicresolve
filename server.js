const express = require("express");
const session = require("express-session");
const path = require("path");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
require("dotenv").config();

const db = require("./db");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static("public"));
app.use(express.static("views"));

app.set("trust proxy", 1);

app.use(
  session({
    secret: "complaint_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

const otpStorage = {};
const OTP_VALIDITY = 10 * 60 * 1000;

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "admin-index.html"));
});

app.post("/api/send-otp", (req, res) => {
  const { email, registrationData } = req.body;

  if (!email) return res.status(400).json({ error: "Email required" });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  otpStorage[email] = {
    code: otp,
    timestamp: Date.now(),
    registrationData
  };

  console.log("OTP:", otp);

  res.json({
    success: true,
    testOtp: otp
  });
});

app.post("/api/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  const data = otpStorage[email];

  if (!data) return res.status(400).json({ error: "OTP expired" });

  if (Date.now() - data.timestamp > OTP_VALIDITY) {
    delete otpStorage[email];
    return res.status(400).json({ error: "OTP expired" });
  }

  if (otp !== data.code)
    return res.status(400).json({ error: "Invalid OTP" });

  const {
    full_name,
    password,
    phone,
    address,
    place,
    district,
    dob,
    pin_code
  } = data.registrationData;

  const hashed = await bcrypt.hash(password, 10);

  db.query(
    "INSERT INTO users (full_name,email,password,phone,address,place,district,dob,pin_code) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      full_name,
      email,
      hashed,
      phone,
      address,
      place,
      district,
      dob,
      pin_code
    ],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });

      delete otpStorage[email];

      res.json({
        success: true,
        redirect: "/login.html"
      });
    }
  );
});

app.post("/login", (req, res) => {
  const { emailOrPhone, password } = req.body;

  db.query(
    "SELECT * FROM users WHERE email=? OR phone=?",
    [emailOrPhone, emailOrPhone],
    async (err, results) => {
      if (results.length === 0)
        return res.status(401).json({ error: "Invalid login" });

      const user = results[0];

      const match = await bcrypt.compare(password, user.password);

      if (!match)
        return res.status(401).json({ error: "Invalid login" });

      req.session.userId = user.id;
      req.session.userName = user.full_name;

      res.json({
        success: true,
        redirect: "/dashboard.html"
      });
    }
  );
});

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  db.query(
    "SELECT * FROM admins WHERE username=?",
    [username],
    async (err, results) => {
      if (results.length === 0)
        return res.status(401).json({ error: "Invalid login" });

      const admin = results[0];

      const match = await bcrypt.compare(password, admin.password);

      if (!match)
        return res.status(401).json({ error: "Invalid login" });

      req.session.adminId = admin.id;
      req.session.adminDistrict = admin.district;

      res.json({
        success: true,
        redirect: "/admin-dashboard.html"
      });
    }
  );
});

const isUserLoggedIn = (req, res, next) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Login required" });
  next();
};

app.post(
  "/submit-complaint",
  isUserLoggedIn,
  upload.single("proof_image"),
  (req, res) => {
    const { department, district, complaint_text } = req.body;

    if (!req.file)
      return res.status(400).json({ error: "Image required" });

    db.query(
      "INSERT INTO complaints (user_id,department,district,complaint_text,proof_image) VALUES (?,?,?,?,?)",
      [
        req.session.userId,
        department,
        district,
        complaint_text,
        req.file.filename
      ],
      (err, result) => {
        if (err) return res.status(500).json({ error: err.message });

        res.json({
          success: true,
          complaintId: result.insertId
        });
      }
    );
  }
);

app.get("/dashboard", isUserLoggedIn, (req, res) => {
  db.query(
    "SELECT * FROM complaints WHERE user_id=?",
    [req.session.userId],
    (err, results) => {
      res.json(results);
    }
  );
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});