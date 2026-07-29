
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  try {
    const payload = await readJson(req);
    const apiKey = process.env.DIRECT_API_KEY || payload.apiKey;
    if (!apiKey) return res.status(400).json({ error: "Missing apiKey" });

    const baseUrl = (process.env.DIRECT_BASE_URL || "https://direct.wawazz.xyz").replace(/\/+$/, "");
    const images = Array.isArray(payload.images) ? payload.images : [];
    const count = Math.max(1, Number(payload.params?.count || 1));

    if (images.length === 0) {
      const upstream = await fetch(`${baseUrl}/v1/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: payload.model,
          prompt: payload.prompt,
          n: count,
          ...(payload.params?.size ? { size: payload.params.size } : {}),
          response_format: "b64_json",
        }),
      });

      return sendUpstream(res, upstream);
    }

    const form = new FormData();
    form.set("model", payload.model);
    form.set("prompt", payload.prompt);
    form.set("n", String(count));
    form.set("response_format", "b64_json");
    if (payload.params?.size) form.set("size", payload.params.size);

    for (const dataUrl of images) {
      form.append("image", dataUrlToBlob(dataUrl), "ref.png");
    }

    const upstream = await fetch(`${baseUrl}/v1/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    return sendUpstream(res, upstream);
  } catch (error) {
    return res.status(500).json({ error: error.message || String(error) });
  }
};

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function sendUpstream(res, upstream) {
  const text = await upstream.text();
  res.status(upstream.status);
  res.setHeader("content-type", upstream.headers.get("content-type") || "application/json");
  res.send(text);
}

function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid dataURL");
  const mime = match[1] || "image/png";
  const buffer = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]));
  return new Blob([buffer], { type: mime });
}
