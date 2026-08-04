import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type ImageRequestInput = {
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

type ImageAttempt = {
    protocol: "openai-compatible" | "web-proxy";
    url: string;
    headers: Record<string, string>;
    model: string;
    prompt: string;
    images: string[];
    params: NonNullable<ImageRequestInput["params"]>;
};

type AttemptResult = {
    ok: boolean;
    status: number;
    text: string;
    json: unknown;
};

export async function POST(request: NextRequest) {
    try {
        const input = (await request.json()) as ImageRequestInput;
        const { baseUrl, apiKey, model, prompt, images = [], params = {} } = input;

        if (!baseUrl || !apiKey || !model || !prompt) {
            return Response.json(
                { error: "Missing baseUrl, apiKey, model or prompt" },
                { status: 400 },
            );
        }

        const attempts = buildAttempts({
            baseUrl,
            apiKey,
            model,
            prompt,
            images,
            params,
        });
        const failures: Array<{
            protocol: string;
            url: string;
            status: number;
            detail: string;
        }> = [];

        for (const attempt of attempts) {
            const result = await sendAttempt(attempt);

            if (result.ok) {
                return Response.json(normalizeResponse(result.json));
            }

            failures.push({
                protocol: attempt.protocol,
                url: attempt.url,
                status: result.status,
                detail: result.text.slice(0, 500),
            });

            if (!shouldTryNextAttempt(result)) {
                break;
            }
        }

        return Response.json(
            {
                error: "No supported image protocol",
                attempts: failures,
            },
            { status: 502 },
        );
    } catch (error) {
        return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
        );
    }
}

function buildAttempts({
    baseUrl,
    apiKey,
    model,
    prompt,
    images,
    params,
}: {
    baseUrl: string;
    apiKey: string;
    model: string;
    prompt: string;
    images: string[];
    params: NonNullable<ImageRequestInput["params"]>;
}) {
    const inputUrl = new URL(baseUrl);
    const origin = inputUrl.origin;
    const isEdit = images.length > 0;
    const action = isEdit ? "edits" : "generations";
    const inputPath = inputUrl.pathname.replace(/\/+$/, "");
    const standardBase = removeKnownSuffix(baseUrl);
    const standardUrl = `${standardBase}/v1/images/${action}`;

    const isProxyEndpoint =
        inputPath.includes("/proxy") ||
        inputPath.includes("/image-studio");

    if (isProxyEndpoint) {
        return [
            createProxyAttempt({
                url: inputUrl.toString(),
                targetUrl: `${origin}/v1/images/${action}`,
                apiKey,
                model,
                prompt,
                images,
                params,
            }),
        ];
    }

    return [
        {
            protocol: "openai-compatible" as const,
            url: standardUrl,
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
            model,
            prompt,
            images,
            params,
        },
        createProxyAttempt({
            url: `${origin}/api/v1/user/image-studio/proxy`,
            targetUrl: standardUrl,
            apiKey,
            model,
            prompt,
            images,
            params,
        }),
    ];
}

function createProxyAttempt({
    url,
    targetUrl,
    apiKey,
    model,
    prompt,
    images,
    params,
}: {
    url: string;
    targetUrl: string;
    apiKey: string;
    model: string;
    prompt: string;
    images: string[];
    params: NonNullable<ImageRequestInput["params"]>;
}): ImageAttempt {
    const headers: Record<string, string> = {
        "x-image-studio-api-key": apiKey,
        "x-image-studio-target-url": targetUrl,
    };

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

async function sendAttempt(attempt: ImageAttempt): Promise<AttemptResult> {
    const count = Number(attempt.params.count || 1);
    const size = attempt.params.size || "1024x1024";
    const quality = attempt.params.quality;

    if (attempt.images.length === 0) {
        const body: Record<string, unknown> = {
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

    for (let index = 0; index < attempt.images.length; index += 1) {
        const dataUrl = attempt.images[index];
        form.append("image", dataUrlToBlob(dataUrl), `ref-${index + 1}.png`);
    }

    const response = await fetch(attempt.url, {
        method: "POST",
        headers: attempt.headers,
        body: form,
    });

    return readResponse(response);
}

async function readResponse(response: Response): Promise<AttemptResult> {
    const text = await response.text();
    let json: unknown = null;

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

function shouldTryNextAttempt(result: AttemptResult) {
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

function normalizeResponse(json: unknown) {
    const payload = json as {
        data?: unknown;
        images?: unknown;
    } | null;

    const nestedData =
        payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)
            ? (payload.data as { data?: unknown }).data
            : undefined;

    const data =
        Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(nestedData)
                ? nestedData
                : Array.isArray(payload?.images)
                    ? payload.images
                    : [];

    return { data };
}

function removeKnownSuffix(value: string) {
    return value
        .trim()
        .replace(/\/+$/, "")
        .replace(/\/v1\/images\/(generations|edits)$/, "")
        .replace(/\/v1$/, "");
}

function dataUrlToBlob(dataUrl: string) {
    const [meta, base64] = dataUrl.split(",");
    const mime = /data:(.*?);base64/.exec(meta)?.[1] || "image/png";

    return new Blob([Buffer.from(base64, "base64")], {
        type: mime,
    });
}
