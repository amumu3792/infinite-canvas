const { Buffer } = require("node:buffer");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const input =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

    const baseUrl = String(input.baseUrl || "")
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/v1\/images\/(generations|edits)$/, "")
      .replace(/\/v1$/, "");

    const apiKey = String(input.apiKey || "");
    const model = String(input.model || "");
    const prompt = String(input.prompt || "");
    const images = Array.isArray(input.images) ? input.images : [];

    if (!baseUrl || !apiKey || !model || !prompt) {
      return res.status(400).json({
        error: "Missing baseUrl, apiKey, model or prompt",
      });
    }

    const response = images.length
      ? await createImageEdit(baseUrl, apiKey, model, prompt, images)
      : await createImage(baseUrl, apiKey, model, prompt);

    const text = await response.text();

    if (!response.ok) {
      return res.status(502).json({
        error: "Image provider request failed",
        status: response.status,
        detail: text.slice(0, 2000),
      });
    }

    let result;
    try {
      result = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "Image provider returned invalid JSON",
        detail: text.slice(0, 2000),
      });
    }

    const data = normalizeResult(result);

    if (!data.length) {
      return res.status(502).json({
        error: "Image provider returned no images",
        detail: result,
      });
    }

    return res.status(200).json({ data });
  } catch (error) {
    return res.status(500).json({
      error: "Image proxy failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

async function createImage(baseUrl, apiKey, model, prompt) {
  return fetch(`${baseUrl}/v1/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
    }),
  });
}

async function createImageEdit(baseUrl, apiKey, model, prompt, images) {
  const form = new FormData();

  form.set("model", model);
  form.set("prompt", prompt);
  form.set("n", "1");

  for (let index = 0; index < images.length; index += 1) {
    form.append(
      "image",
      dataUrlToBlob(images[index]),
      `reference-${index + 1}.png`,
    );
  }

  return fetch(`${baseUrl}/v1/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
}

function normalizeResult(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.data?.data)) return result.data.data;
  if (Array.isArray(result?.images)) return result.images;
  return [];
}

function dataUrlToBlob(value) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(String(value || ""));

  if (!match) {
    throw new Error("Reference image is not a valid dataURL");
  }

  return new Blob([Buffer.from(match[2], "base64")], {
    type: match[1] || "image/png",
  });
}
