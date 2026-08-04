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
        url: attempt.url,
        status: result.status,
        detail: result.text.slice(0, 300),
      });

      if (!shouldTryNextAttempt(result)) {
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

function shouldTryNextAttempt(result) {
  const text = String(result.text || "");
  const looksLikeHtml =
    text.trim().startsWith("<") ||
    text.includes("<!DOCTYPE html") ||
    text.includes("<html");

  return (
    looksLikeHtml ||
    [400, 401, 403, 404, 405, 415, 422].includes(result.status)
  );
}

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

  if (process.env.IMAGE_PROXY_BEARER) {
    headers.Authorization = `Bearer ${process.env.IMAGE_PROXY_BEARER}`;
  }

  return {
    protocol: "web-proxy",
    ur
