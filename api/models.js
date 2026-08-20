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
      .replace(/\/v1$/, "");

    const apiKey = String(input.apiKey || "").trim();

    if (!baseUrl || !apiKey) {
      return res.status(400).json({
        error: "Missing baseUrl or apiKey",
      });
    }

    const response = await fetch(`${baseUrl}/v1/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    const text = await response.text();

    if (!response.ok) {
      return res.status(502).json({
        error: "Model provider request failed",
        status: response.status,
        detail: text.slice(0, 2000),
      });
    }

    let result;

    try {
      result = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "Model provider returned invalid JSON",
        detail: text.slice(0, 2000),
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      error: "Model proxy failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
