import { ApiError, apiFetch, apiFetchStream } from "@/lib/api-client";
import {
  aiModelListResponseSchema,
  aiRecognitionStreamEventSchema,
  aiRecognitionTestResponseSchema,
  aiRecognizeResponseSchema,
  type AiModelListRequest,
  type AiModelListResponse,
  type AiRecognitionSettings,
  type AiRecognitionStreamEvent,
  type AiRecognitionTestResponse,
  type AiRecognizeResponse,
  type AiThinkingControl,
} from "@/lib/api/schemas/ai-recognition";

const AI_RECOGNITION_STREAM_RESPONSE_TIMEOUT_MS = 30_000;
const AI_RECOGNITION_STREAM_IDLE_TIMEOUT_MS = 120_000;

interface RecognizeSubscriptionsInput {
  text: string;
  images: File[];
  thinkingControl: AiThinkingControl | null;
}

interface RecognizeSubscriptionsStreamHandlers {
  onEvent?: (event: AiRecognitionStreamEvent) => void;
}

interface RecognizeSubscriptionsStreamOptions {
  signal?: AbortSignal;
}

export const aiRecognitionService = {
  async listModels(input: AiModelListRequest): Promise<AiModelListResponse> {
    return await apiFetch("/api/app/ai/models/list", aiModelListResponseSchema, {
      method: "POST",
      body: JSON.stringify(input),
      timeoutMs: 20_000,
    });
  },

  async recognizeSubscriptions(input: RecognizeSubscriptionsInput): Promise<AiRecognizeResponse> {
    return await apiFetch("/api/app/ai/subscriptions/recognize", aiRecognizeResponseSchema, {
      method: "POST",
      body: createRecognizeSubscriptionsFormData(input),
      timeoutMs: 120_000,
    });
  },

  async recognizeSubscriptionsStream(
    input: RecognizeSubscriptionsInput,
    handlers: RecognizeSubscriptionsStreamHandlers = {},
    options: RecognizeSubscriptionsStreamOptions = {},
  ): Promise<AiRecognizeResponse> {
    return await apiFetchStream(
      "/api/app/ai/subscriptions/recognize/stream",
      {
        method: "POST",
        body: createRecognizeSubscriptionsFormData(input),
        timeoutMs: AI_RECOGNITION_STREAM_RESPONSE_TIMEOUT_MS,
        streamIdleTimeoutMs: AI_RECOGNITION_STREAM_IDLE_TIMEOUT_MS,
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (response) => consumeRecognitionEventStream(response, handlers.onEvent),
    );
  },

  async testConnection(settings: AiRecognitionSettings): Promise<AiRecognitionTestResponse> {
    return await apiFetch("/api/app/ai/subscriptions/test", aiRecognitionTestResponseSchema, {
      method: "POST",
      body: JSON.stringify({ settings }),
      timeoutMs: 60_000,
    });
  },
};

function createRecognizeSubscriptionsFormData(input: RecognizeSubscriptionsInput): FormData {
  const formData = new FormData();
  formData.set("text", input.text);
  if (input.thinkingControl) {
    formData.set("thinkingControl", JSON.stringify(input.thinkingControl));
  }
  for (const image of input.images) {
    formData.append("images[]", image, image.name);
  }
  return formData;
}

async function consumeRecognitionEventStream(
  response: Response,
  onEvent: ((event: AiRecognitionStreamEvent) => void) | undefined,
): Promise<AiRecognizeResponse> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new ApiError("Invalid stream response", response.status, undefined, "invalid_response");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResponse: AiRecognizeResponse | null = null;

  const readFrame = (frame: string) => {
    const data = frame.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n")
      .trim();
    if (!data) return;

    let payload: unknown;
    try {
      payload = JSON.parse(data) as unknown;
    } catch {
      throw new ApiError("Invalid stream response", response.status, data, "invalid_response", data);
    }
    const parsed = aiRecognitionStreamEventSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiError("Invalid stream response", response.status, parsed.error.flatten(), "invalid_response", data);
    }
    const event = parsed.data;
    onEvent?.(event);
    if (event.type === "recognition/error") {
      throw new ApiError(event.message, response.status, event.details, event.code, data);
    }
    if (event.type === "recognition/final") {
      finalResponse = event.response;
    }
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      let separator = buffer.indexOf("\n\n");
      while (separator >= 0) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        readFrame(frame);
        separator = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const tail = buffer.trim();
  if (tail) readFrame(tail);
  if (!finalResponse) {
    throw new ApiError("Invalid stream response", response.status, undefined, "invalid_response");
  }
  return finalResponse;
}
