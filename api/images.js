module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const input =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const {
      baseUrl,
      apiKey,
      model,
      prompt,
      images = [],
      params = {},
    } = input;

    if (!baseUrl || !apiKey || !model || !prompt) {
      return res.status(400).json({
        error: "Missing baseUrl, apiKey, model or prompt",
      });
    }

    const attempts = buildAttempts({
      baseUrl,
      apiKey,
      model,
      prompt,
      images,
      params,
    });

    const failures = [];

    for (const attempt of attempts) {
      const result = await sendAttempt(attempt);

      if (result.ok) {
        return res.status(200).json(normalizeResponse(result.json));
      }

      failures.push({
        protocol: attempt.protocol,
        status: result.status,
        detail: result.text.slice(0, 300),
      });

      // 只有明确的“路径/格式不存在”才尝试下一种协议
      if (![400, 401, 403, 404, 405, 415].includes(result.status)) {
        break;
      }
    }

    return res.status(502).json({
      error: "No supported image protocol",
      attempts: failures,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || String(error),
    });
  }
};

function buildAttempts({ baseUrl, apiKey, model, prompt, images, params }) {
  const inputUrl = new URL(baseUrl);
  const origin = inputUrl.origin;
  const isEdit = images.length > 0;
  const action = isEdit ? "edits" : "generations";

  const attempts = [];
  const inputPath = inputUrl.pathname.replace(/\/+$/, "");

  const isProxyEndpoint =
    inputPath.includes("/proxy") ||
    inputPath.includes("/image-studio");

  if (isProxyEndpoint) {
    attempts.push(
      createProxyAttempt({
        url: inputUrl.toString(),
        targetUrl: `${origin}/v1/images/${action}`,
        apiKey,
        model,
        prompt,
        images,
        params,
      })
    );

    return attempts;
  }

  const standardBase = removeKnownSuffix(baseUrl);
  const standardUrl = `${standardBase}/v1/images/${action}`;

  attempts.push({
    protocol: "openai-compatible",
    url: standardUrl,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    model,
    prompt,
    images,
    params,
  });

  // 常见网页代理路径。无需写死网站域名。
  attempts.push(
    createProxyAttempt({
      url: `${origin}/api/v1/user/image-studio/proxy`,
      targetUrl: standardUrl,
      apiKey,
      model,
      prompt,
      images,
      params,
    })
  );

  return attempts;
}

function createProxyAttempt({
  url,
  targetUrl,
  apiKey,
  model,
  prompt,
  images,
  params,
}) {
  const headers = {
    "x-image-studio-api-key": apiKey,
    "x-image-studio-target-url": targetUrl,
  };

  // 某些网页代理需要网页登录 token。
  // 没有配置时不发送 Authorization。
  if (process.env.IMAGE_PROXY_BEARER) {
    headers.Authorization = `Bearer ${process.env.IMAGE_PROXY_BEARER}`;
  }

  return {
    protocol: "web-proxy",
    url,
    headers,
    model,
    prompt,
    images,
    params,
  };
}

async function sendAttempt(attempt) {
  const count = Number(attempt.params.count || 1);
  const size = attempt.params.size || "1024x1024";
  const quality = attempt.params.quality;

  if (attempt.images.length === 0) {
    const body = {
      model: attempt.model,
      prompt: attempt.prompt,
      n: count,
      size,
      response_format: "b64_json",
    };

    if (quality) {
      body.quality = quality;
    }

    const response = await fetch(attempt.url, {
      method: "POST",
      headers: {
        ...attempt.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    return readResponse(response);
  }

  const form = new FormData();

  form.set("model", attempt.model);
  form.set("prompt", attempt.prompt);
  form.set("n", String(count));
  form.set("size", size);
  form.set("response_format", "b64_json");

  if (quality) {
    form.set("quality", quality);
  }

  for (const dataUrl of attempt.images) {
    form.append("image", dataUrlToBlob(dataUrl), "ref.png");
  }

  const response = await fetch(attempt.url, {
    method: "POST",
    headers: attempt.headers,
    body: form,
  });

  return readResponse(response);
}

async function readResponse(response) {
  const text = await response.text();

  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    text,
    json,
  };
}

function normalizeResponse(json) {
  const data =
    Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.data?.data)
        ? json.data.data
        : Array.isArray(json?.images)
          ? json.images
          : [];

  return { data };
}

function removeKnownSuffix(value) {
  return value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1\/images\/(generations|edits)$/, "")
    .replace(/\/v1$/, "");
}

function dataUrlToBlob(dataUrl) {
  const [meta, base64] = dataUrl.split(",");
  const mime =
    /data:(.*?);base64/.exec(meta)?.[1] || "image/png";

  return new Blob([Buffer.from(base64, "base64")], {
    type: mime,
  });
}
