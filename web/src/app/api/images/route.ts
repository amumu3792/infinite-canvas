export const runtime = "nodejs";
export const maxDuration = 300;

type ImageProxyBody = {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    prompt?: string;
    images?: string[];
    params?: {
        count?: number | string;
        size?: string;
        quality?: string;
    };
};

export async function POST(request: Request) {
    try {
        const body = (await request.json()) as ImageProxyBody;

        const baseUrl = String(body.baseUrl || "").replace(/\/+$/, "");
        const apiKey = String(body.apiKey || "");
        const model = String(body.model || "");
        const prompt = String(body.prompt || "");
        const images = Array.isArray(body.images) ? body.images : [];
        const params = body.params || {};

        if (!baseUrl || !apiKey || !model || !prompt) {
            return json({ error: "Missing baseUrl, apiKey, model or prompt" }, 400);
        }

        const endpoint = images.length > 0 ? "/v1/images/edits" : "/v1/images/generations";
        const url = `${removeImageEndpointSuffix(baseUrl)}${endpoint}`;

        const response = images.length > 0
            ? await requestImageEdit(url, apiKey, model, prompt, images, params)
            : await requestImageGeneration(url, apiKey, model, prompt, params);

        const text = await response.text();

        if (!response.ok) {
            return json(
                {
                    error: "Upstream image request failed",
                    url,
                    status: response.status,
                    detail: text.slice(0, 1000),
                },
                502,
            );
        }

        try {
            const data = JSON.parse(text);
            return json(normalizeImageResponse(data), 200);
        } catch {
            return json(
                {
                    error: "Upstream returned invalid JSON",
                    url,
                    status: response.status,
                    detail: text.slice(0, 1000),
                },
                502,
            );
        }
    } catch (error) {
        return json(
            {
                error: "Image proxy crashed",
                detail: error instanceof Error ? error.message : String(error),
            },
            500,
        );
    }
}

async function requestImageGeneration(
    url: string,
    apiKey: string,
    model: string,
    prompt: string,
    params: NonNullable<ImageProxyBody["params"]>,
) {
    const payload: Record<string, unknown> = {
        model,
        prompt,
        n: Number(params.count || 1),
        size: params.size || "1024x1024",
        response_format: "url",
    };

    if (params.quality) {
        payload.quality = params.quality;
    }

    return fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

async function requestImageEdit(
    url: string,
    apiKey: string,
    model: string,
    prompt: string,
    images: string[],
    params: NonNullable<ImageProxyBody["params"]>,
) {
    const form = new FormData();

    form.set("model", model);
    form.set("prompt", prompt);
    form.set("n", String(Number(params.count || 1)));
    form.set("size", params.size || "1024x1024");
    form.set("response_format", "url");

    if (params.quality) {
        form.set("quality", params.quality);
    }

    for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        form.append("image", dataUrlToBlob(image), `reference-${index + 1}.png`);
    }

    return fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
        body: form,
    });
}

function normalizeImageResponse(data: unknown) {
    const payload = data as {
        data?: unknown;
        images?: unknown;
    };

    const items =
        Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.images)
                ? payload.images
                : Array.isArray(data)
                    ? data
                    : [];

    return { data: items };
}

function removeImageEndpointSuffix(baseUrl: string) {
    return baseUrl
        .replace(/\/+$/, "")
        .replace(/\/v1\/images\/(generations|edits)$/, "")
        .replace(/\/v1$/, "");
}

function dataUrlToBlob(dataUrl: string) {
    const match = /^data:(.*?);base64,(.*)$/.exec(dataUrl);
    if (!match) {
        throw new Error("Reference image must be a dataURL");
    }

    const mime = match[1] || "image/png";
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mime });
}

function json(data: unknown, status: number) {
    return Response.json(data, { status });
}
