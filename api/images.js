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

    const apiKey = String(input.apiKey || "").trim();
    const model = String(input.model || "").trim();
    const prompt = String(input.prompt || "").trim();
    const images = Array.isArray(input.images) ? input.images : [];
    const params = input.params || {};

    if (!baseUrl || !apiKey || !model || !prompt) {
      return res.status(400).json({
        error: "Missing baseUrl, apiKey, model or prompt",
      });
    }

    const response = images.length
      ? await createImageEdit(baseUrl, apiKey, model, prompt, images, params)
      : await createImage(baseUrl, apiKey, model, prompt, params);

    const text = await response.text();

    if (!response.ok) {
      return res.status(502).json({
        error: "Image provider request failed",
        status: response.status,
        detail: text.slice(0, 1000),
      });
    }

    let result;

    try {
      result = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "Image provider returned invalid JSON",
        detail: text.slice(0, 1000),
      });
    }

    // 媒体接口可能先返回 in_progress，需要继续查询任务状态。
    if (isMediaApi(baseUrl) && isMediaJob(result)) {
      result = await waitForMediaJob(baseUrl, apiKey, result);
    }

    const data = normalizeResult(result);

    if (!data.length) {
      return res.status(502).json({
        error: "Image provider returned no images",
        detail: result,
      });
    }

    // 媒体接口返回的图片 URL 可能被浏览器 CORS 拦截。
    // 在 Vercel 服务端下载后转换成 data URL。
    const finalData = isMediaApi(baseUrl)
      ? await materializeImages(data)
      : data;

    return res.status(200).json({ data: finalData });
  } catch (error) {
    return res.status(500).json({
      error: "Image proxy failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};

async function createImage(baseUrl, apiKey, model, prompt, params) {
  const media = isMediaApi(baseUrl);

  const payload = {
    model,
    prompt,
    n: media ? 1 : normalizeCount(params.count),
    response_format: "url",
  };

  if (media) {
    payload.size = normalizeMediaSize(params.size, model);

    if (model === "gpt-image-2") {
      payload.quality = "medium";
    }
  } else {
    if (params.size && params.size !== "auto") {
      payload.size = params.size;
    }

    if (params.quality && params.quality !== "auto") {
      payload.quality = params.quality;
    }
  }

  return fetch(`${baseUrl}/v1/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function createImageEdit(
  baseUrl,
  apiKey,
  model,
  prompt,
  images,
  params,
) {
  const media = isMediaApi(baseUrl);
  const form = new FormData();

  form.set("model", model);
  form.set("prompt", prompt);
  form.set("n", String(media ? 1 : normalizeCount(params.count)));
  form.set("response_format", "url");

  if (media) {
    form.set("size", normalizeMediaSize(params.size, model));

    if (model === "gpt-image-2") {
      form.set("quality", "medium");
    }
  } else {
    if (params.size && params.size !== "auto") {
      form.set("size", params.size);
    }

    if (params.quality && params.quality !== "auto") {
      form.set("quality", params.quality);
    }
  }

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

function isMediaApi(baseUrl) {
  return /\/media$/i.test(baseUrl);
}

function isMediaJob(result) {
  return (
    result &&
    (
      result.type === "media.job" ||
      (
        result.id &&
        [
          "queued",
          "pending",
          "in_progress",
          "processing",
        ].includes(result.status)
      )
    )
  );
}

async function waitForMediaJob(baseUrl, apiKey, job) {
  let current = job;

  // 最多等待 60 秒，每 1.5 秒查询一次。
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (
      [
        "completed",
        "succeeded",
        "failed",
        "cancelled",
        "expired",
      ].includes(current.status)
    ) {
      break;
    }

    await sleep(1500);

    const response = await fetch(
      `${baseUrl}/v1/jobs/${encodeURIComponent(job.id)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `Media job polling failed: ${response.status} ${text.slice(0, 500)}`,
      );
    }

    try {
      current = JSON.parse(text);
    } catch {
      throw new Error(
        `Media job polling returned invalid JSON: ${text.slice(0, 500)}`,
      );
    }
  }

  if (current.status === "failed") {
    throw new Error(
      current.error?.message || "Media image job failed",
    );
  }

  if (current.status === "cancelled") {
    throw new Error("Media image job was cancelled");
  }

  if (current.status === "expired") {
    throw new Error("Media image job expired");
  }

  if (
    !["completed", "succeeded"].includes(current.status)
  ) {
    throw new Error("Media image job timed out after 60 seconds");
  }

  return current;
}

async function materializeImages(items) {
  return Promise.all(
    items.map(async (item) => {
      if (typeof item === "string") {
        if (item.startsWith("data:")) {
          return item;
        }

        return downloadAsDataUrl(item);
      }

      if (item?.dataUrl) {
        return item.dataUrl;
      }

      if (item?.b64_json) {
        return `data:image/png;base64,${item.b64_json}`;
      }

      if (item?.url) {
        return downloadAsDataUrl(item.url);
      }

      throw new Error(
        "Image item missing dataUrl/url/b64_json",
      );
    }),
  );
}

async function downloadAsDataUrl(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Generated image download failed: ${response.status}`,
    );
  }

  const contentType =
    response.headers.get("content-type") || "image/png";

  const buffer = Buffer.from(await response.arrayBuffer());

  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function normalizeCount(value) {
  const count = Number(value || 1);

  if (!Number.isFinite(count) || count < 1) {
    return 1;
  }

  return Math.min(Math.floor(count), 4);
}

function normalizeMediaSize(size, model) {
  if (
    model === "canvas-image-fast" ||
    model === "canvas-image-lite" ||
    model === "gpt-image-2"
  ) {
    return "1K";
  }

  if (!size || size === "auto") {
    return "1K";
  }

  if (
    size === "1K" ||
    size === "1024x1024" ||
    size === "1024x1536" ||
    size === "1536x1024"
  ) {
    return "1K";
  }

  if (
    size === "2K" ||
    size === "2048x2048" ||
    size === "2048x3072" ||
    size === "3072x2048"
  ) {
    return "2K";
  }

  if (
    size === "4K" ||
    size === "4096x4096" ||
    size === "4096x6144" ||
    size === "6144x4096"
  ) {
    return "4K";
  }

  return "1K";
}

function normalizeResult(result) {
  if (Array.isArray(result)) {
    return result;
  }

  if (Array.isArray(result?.data)) {
    return result.data;
  }

  if (Array.isArray(result?.data?.data)) {
    return result.data.data;
  }

  if (Array.isArray(result?.outputs)) {
    return result.outputs;
  }

  if (Array.isArray(result?.output)) {
    return result.output;
  }

  if (Array.isArray(result?.images)) {
    return result.images;
  }

  return [];
}

function dataUrlToBlob(value) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(
    String(value || ""),
  );

  if (!match) {
    throw new Error(
      "Reference image is not a valid dataURL",
    );
  }

  return new Blob([Buffer.from(match[2], "base64")], {
    type: match[1] || "image/png",
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
