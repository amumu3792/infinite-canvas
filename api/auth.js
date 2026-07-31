export default function handler(req, res) {
  const SITE_USER = process.env.SITE_USER;
  const SITE_PASS = process.env.SITE_PASS;

  // 如果环境变量没配置，直接返回错误，不暴露任何默认密码
  if (!SITE_USER || !SITE_PASS) {
    return res.status(500).json({ error: 'Server not configured properly' });
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const password = url.searchParams.get('password');
  const redirect = url.searchParams.get('to') || '/';

  // 密码正确，设置 cookie
  if (password === SITE_PASS) {
    res.setHeader('Set-Cookie', `auth_user=${SITE_USER}; Path=/; Max-Age=86400; SameSite=Lax; HttpOnly`);
    res.writeHead(302, { Location: redirect });
    res.end();
    return;
  }

  // 检查 cookie
  const cookies = req.headers.cookie || '';
  if (cookies.includes(`auth_user=${SITE_USER}`)) {
    res.writeHead(302, { Location: redirect });
    res.end();
    return;
  }

  // 显示登录页面
  res.setHeader('Content-Type', 'text/html');
  res.end(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>请输入访问密码</title>
      <style>
        body { display: flex; justify-content: center; align-items: center; height: 100vh; background: #f5f5f5; font-family: sans-serif; }
        .box { background: white; padding: 50px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; }
        h2 { margin-bottom: 25px; color: #333; }
        input { padding: 12px 16px; font-size: 16px; border: 2px solid #ddd; border-radius: 8px; width: 240px; margin-bottom: 20px; }
        input:focus { border-color: #0070f3; outline: none; }
        button { padding: 12px 35px; font-size: 16px; background: #0070f3; color: white; border: none; border-radius: 8px; cursor: pointer; }
        button:hover { background: #0051a2; }
      </style>
    </head>
    <body>
      <div class="box">
        <h2>🔒 请输入密码</h2>
        <form method="GET" action="/api/auth">
          <input type="password" name="password" placeholder="输入密码" required />
          <br />
          <button type="submit">进入</button>
        </form>
      </div>
    </body>
    </html>
  `);
}
