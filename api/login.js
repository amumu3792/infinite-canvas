const crypto = require("crypto");

const COOKIE_NAME = "site_session";
const SESSION_DAYS = 7;

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const sitePassword = process.env.SITE_PASSWORD;
  const sessionSecret = process.env.SESSION_SECRET;

  if (!sitePassword || !sessionSecret) {
    return res.status(500).json({
      error: "Login environment variables are not configured",
    });
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const password = String(body.password || "");

    if (!safeEqual(password, sitePassword)) {
      return res.status(401).json({
        error: "Invalid password",
      });
    }

    const expiresAt =
      Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60;

    const payload = String(expiresAt);
    const signature = sign(payload, sessionSecret);
    const cookieValue = `${payload}.${signature}`;

    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=${cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}`
    );

    return res.status(200).json({
      ok: true,
      expiresAt,
    });
  } catch {
    return res.status(400).json({
      error: "Invalid JSON",
    });
  }
};

function sign(value, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(value)
    .digest("base64url");
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}
