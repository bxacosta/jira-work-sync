// ─── HTTP Client Base ───────────────────────────────────
// Reusable fetch wrapper with retry, rate-limit handling, and logging.

import { formatJson } from "../constants.ts";
import { logger } from "../logger/index.ts";

const TRAILING_SLASH_RE = /\/$/;

export interface HttpClientOptions {
    baseUrl: string;
    headers: Record<string, string>;
    maxRetries?: number;
}

export interface HttpResponse<T> {
    data: T;
    headers: Headers;
    ok: boolean;
    status: number;
}

export class HttpClientError extends Error {
    readonly status: number;
    readonly statusText: string;
    readonly body: string;
    readonly url: string;

    constructor(status: number, statusText: string, body: string, url: string) {
        super(`HTTP ${status} ${statusText} — ${url}`);
        this.name = "HttpClientError";
        this.status = status;
        this.statusText = statusText;
        this.body = body;
        this.url = url;
    }
}

export class HttpClient {
    private readonly baseUrl: string;
    private readonly headers: Record<string, string>;
    private readonly maxRetries: number;

    constructor(options: HttpClientOptions) {
        this.baseUrl = options.baseUrl.replace(TRAILING_SLASH_RE, "");
        this.headers = options.headers;
        this.maxRetries = options.maxRetries ?? 3;
    }

    get<T>(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<HttpResponse<T>> {
        const url = this.buildUrl(path, params);
        return this.request<T>("GET", url);
    }

    post<T>(path: string, body?: unknown): Promise<HttpResponse<T>> {
        const url = this.buildUrl(path);
        return this.request<T>("POST", url, body);
    }

    put<T>(path: string, body?: unknown): Promise<HttpResponse<T>> {
        const url = this.buildUrl(path);
        return this.request<T>("PUT", url, body);
    }

    private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
        const url = new URL(`${this.baseUrl}${path}`);
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined) {
                    url.searchParams.set(key, String(value));
                }
            }
        }
        return url.toString();
    }

    private async handleRateLimitRetry(response: Response, attempt: number, url: string): Promise<void> {
        const retryAfter = response.headers.get("Retry-After");
        const waitMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : 2 ** (attempt + 1) * 1000;
        logger.warn(
            "HTTP",
            `Rate limited (429). Retry ${attempt + 1}/${this.maxRetries} in ${waitMs / 1000}s -- ${url}`
        );
        await Bun.sleep(waitMs);
    }

    private async handleServerErrorRetry(status: number, attempt: number): Promise<void> {
        const waitMs = 2 ** (attempt + 1) * 1000;
        logger.warn("HTTP", `Server error (${status}). Retry ${attempt + 1}/${this.maxRetries} in ${waitMs / 1000}s`);
        await Bun.sleep(waitMs);
    }

    private async handleNetworkError(err: unknown, attempt: number): Promise<void> {
        if (attempt >= this.maxRetries) {
            return;
        }
        const waitMs = 2 ** (attempt + 1) * 1000;
        logger.warn(
            "HTTP",
            `Network error. Retry ${attempt + 1}/${this.maxRetries} in ${waitMs / 1000}s: ${(err as Error).message}`
        );
        await Bun.sleep(waitMs);
    }

    private parseResponseBody<T>(text: string): T {
        try {
            return text ? (JSON.parse(text) as T) : ({} as T);
        } catch {
            return text as unknown as T;
        }
    }

    private async request<T>(method: string, url: string, body?: unknown): Promise<HttpResponse<T>> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                const options: RequestInit = {
                    method,
                    headers: { ...this.headers, "Content-Type": "application/json", Accept: "application/json" },
                };

                if (body !== undefined) {
                    options.body = JSON.stringify(body);
                }

                logger.debug("HTTP", `>> ${method} ${url}`);
                if (body !== undefined) {
                    logger.debug("HTTP", `>> Body:\n${formatJson(body)}`);
                }

                const response = await fetch(url, options);

                if (response.status === 429) {
                    await this.handleRateLimitRetry(response, attempt, url);
                    continue;
                }

                if (response.status >= 500 && attempt < this.maxRetries) {
                    await this.handleServerErrorRetry(response.status, attempt);
                    continue;
                }

                const text = await response.text();
                const data = this.parseResponseBody<T>(text);

                if (!response.ok) {
                    logger.debug("HTTP", `<< ERROR ${response.status}:\n${formatJson(JSON.parse(text))}`);
                    throw new HttpClientError(response.status, response.statusText, text, url);
                }

                logger.debug("HTTP", `<< ${method} ${url} -- ${response.status}`);
                logger.debug("HTTP", `<< Body:\n${formatJson(data)}`);
                return { status: response.status, ok: response.ok, data, headers: response.headers };
            } catch (err) {
                if (err instanceof HttpClientError) {
                    throw err;
                }
                lastError = err as Error;
                await this.handleNetworkError(err, attempt);
            }
        }

        throw lastError ?? new Error(`Request failed after ${this.maxRetries} retries: ${url}`);
    }
}
