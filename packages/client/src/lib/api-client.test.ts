// apiFetch 测试保护 Zod 运行时校验、错误归一和超时取消语义，是前端网络边界的主回归基线。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, apiFetchStream } from "./api-client";
import { okResponseSchema } from "@/lib/api/schemas/common";

const mocks = vi.hoisted(() => ({
  clearAuthSession: vi.fn(),
}));

vi.mock("@/lib/auth-session", () => ({
  clearAuthSession: mocks.clearAuthSession,
}));

describe("api-client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mocks.clearAuthSession.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("parses successful JSON responses without content-type on bodyless GET requests", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(apiFetch("/api/example", okResponseSchema)).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/example");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe("include");
    expect(init.headers).toBeInstanceOf(Headers);
    expect((init.headers as Headers).has("content-type")).toBe(false);
    expect((init.headers as Headers).get("Accept-Language")).toBeTruthy();
    expect((init.headers as Headers).get("X-Renewlet-Locale")).toBeTruthy();
  });

  it("sends JSON content-type when a non-FormData body is present", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await apiFetch("/api/example", okResponseSchema, {
      method: "POST",
      body: JSON.stringify({ ok: true }),
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Headers).get("content-type")).toBe("application/json");
  });

  it("does not set content-type for FormData bodies", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const form = new FormData();
    form.append("file", new Blob(["x"], { type: "image/png" }), "logo.png");

    await apiFetch("/api/app/assets", okResponseSchema, {
      method: "POST",
      body: form,
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Headers).has("content-type")).toBe(false);
  });

  it("does not rewrite legacy API paths", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await apiFetch("/api/setup", okResponseSchema);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/setup");
  });

  it("throws ApiError with backend message and status on non-2xx responses", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Bad payload" }), { status: 400 }));

    await expect(apiFetch("/api/example", okResponseSchema)).rejects.toMatchObject({
      name: "ApiError",
      message: "Bad payload",
      status: 400,
    });
  });

  it("reads problem details and backend codes from non-2xx responses", async () => {
    const fetchMock = vi.mocked(fetch);
    const rawResponseText = JSON.stringify({
      error: "请先登录后再操作",
      code: "UNAUTHORIZED",
      title: "未登录",
      status: 401,
      detail: "请先登录后再操作",
    });
    fetchMock.mockResolvedValue(new Response(rawResponseText, { status: 401 }));

    await expect(apiFetch("/api/example", okResponseSchema)).rejects.toMatchObject({
      name: "ApiError",
      message: "请先登录后再操作",
      status: 401,
      code: "UNAUTHORIZED",
      rawResponseText,
    });
    expect(mocks.clearAuthSession).toHaveBeenCalledTimes(1);
  });

  it("does not clear auth session for AI model list provider failures", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      message: "无法获取模型列表，请检查 Base URL 和 API Key，或手动输入模型 ID。",
      code: "AI_MODEL_LIST_FAILED",
      details: {
        rawResponseText: "{\"code\":\"INVALID_API_KEY\",\"message\":\"Invalid API key\"}",
      },
    }), { status: 401 }));

    await expect(apiFetch("/api/app/ai/models/list", okResponseSchema)).rejects.toMatchObject({
      name: "ApiError",
      message: "无法获取模型列表，请检查 Base URL 和 API Key，或手动输入模型 ID。",
      status: 401,
      code: "AI_MODEL_LIST_FAILED",
    });
    expect(mocks.clearAuthSession).not.toHaveBeenCalled();
  });

  it("turns legacy Zod field errors into a readable message", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: "Invalid payload",
      details: {
        formErrors: [],
        fieldErrors: {
          email: ["邮箱格式无效"],
          password: ["密码至少需要 8 位"],
        },
      },
    }), { status: 400 }));

    await expect(apiFetch("/api/example", okResponseSchema)).rejects.toMatchObject({
      message: "请求参数无效：email: 邮箱格式无效；password: 密码至少需要 8 位",
      status: 400,
    });
  });

  it("falls back to statusText when an error response is not JSON", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response("not-json", { status: 502, statusText: "Bad Gateway" }));

    await expect(apiFetch("/api/example", okResponseSchema)).rejects.toMatchObject({
      message: "Bad Gateway",
      status: 502,
      rawResponseText: "not-json",
    });
  });

  it("classifies timeout aborts", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      (init as RequestInit).signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    }));

    const promise = apiFetch("/api/slow", okResponseSchema, { timeoutMs: 50 });
    const assertion = expect(promise).rejects.toMatchObject({
      status: 0,
      code: "timeout",
    } satisfies Partial<ApiError>);
    await vi.advanceTimersByTimeAsync(50);

    await assertion;
  });

  it("classifies caller-initiated aborts", async () => {
    const controller = new AbortController();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      (init as RequestInit).signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    }));

    const promise = apiFetch("/api/cancelled", okResponseSchema, { signal: controller.signal, timeoutMs: 0 });
    const assertion = expect(promise).rejects.toMatchObject({
      status: 0,
      code: "aborted",
    } satisfies Partial<ApiError>);
    controller.abort();

    await assertion;
  });

  it("keeps stream response timeout scoped to headers after the response starts", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        setTimeout(() => {
          controller.enqueue(new TextEncoder().encode("ok"));
          controller.close();
        }, 80);
      },
    })));

    const promise = apiFetchStream("/api/stream", {
      timeoutMs: 50,
      streamIdleTimeoutMs: 100,
    }, async (response) => await response.text());
    const assertion = expect(promise).resolves.toBe("ok");
    await vi.advanceTimersByTimeAsync(80);

    await assertion;
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit & { streamIdleTimeoutMs?: number };
    expect(init.streamIdleTimeoutMs).toBeUndefined();
  });

  it("classifies stream idle timeouts after headers are received", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(new ReadableStream<Uint8Array>()));

    const promise = apiFetchStream("/api/stream-idle", {
      timeoutMs: 50,
      streamIdleTimeoutMs: 100,
    }, async (response) => await response.text());
    const assertion = expect(promise).rejects.toMatchObject({
      status: 0,
      code: "timeout",
    } satisfies Partial<ApiError>);
    await vi.advanceTimersByTimeAsync(100);

    await assertion;
  });

  it("keeps caller aborts working while a stream body is being consumed", async () => {
    const controller = new AbortController();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response(new ReadableStream<Uint8Array>()));

    const promise = apiFetchStream("/api/stream-cancelled", {
      signal: controller.signal,
      timeoutMs: 0,
      streamIdleTimeoutMs: 0,
    }, async (response) => await response.text());
    const assertion = expect(promise).rejects.toMatchObject({
      status: 0,
      code: "aborted",
    } satisfies Partial<ApiError>);
    controller.abort();

    await assertion;
  });

});
