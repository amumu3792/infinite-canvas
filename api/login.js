const crypto = require("crypto");

const COOKIE_NAME = "site_session";
const SESSION_DAYS = 7;

module.exports = async function handler(req, res) {
  const sitePassword = process.env.SITE_PASSWORD;
  const sessionSecret = process.env.SESSION_SECRET;

  if (!sitePassword || !sessionSecret) {
    return res.status(500).send("SITE_PASSWORD or SESSION_SECRET is missing");
  }

  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");

    return res.status(200).send(`
      <!doctype html>
      <html lang="zh-CN">
      <head>
        <meta charset="utf-8">
        <title>登录</title>
      </head>
      <body style="max-width:360px;margin:80px auto;font-family:Arial">
        <h2>网站登录</h2>
        <form method="POST" action="/api/login">
          <input
            name="password"
            type="password"
            placeholder="请输入密码"
            required
            style="width:100%;padding:10px;box-sizing:border-box"
          >
          <button
            type="submit"
            style="margin-top:12px;padding:10px 20px"
          >
            登录
          </button>
        </form>
      </body>
      </html>
    `);
  }

  if (req.method !== "POST") {
    return res.status(405).send("Use GET or POST");
  }

  let password = "";

  if (typeof req.body === "string") {
    password = new URLSearchParams(req.body).get("password") || "";
  } else {
    password = String(req.body?.password || "");
  }

  if (!safeEqual(password, sitePassword)) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");

    return res.status(401).send(`
      <p>密码错误</p>
      <p><a href="/api/login">返回登录</a></p>
    `);
  }

  const expiresAt =
    Math.floor(Date.now() / 1000) + SESSION_DAYS * 24 * 60 * 60;

  const payload = String(expiresAt);
  const signature = sign(payload, sessionSecret);

  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 60 * 60}`
  );

  res.setHeader("Location", "/canvas");
  return res.status(302).end();
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
