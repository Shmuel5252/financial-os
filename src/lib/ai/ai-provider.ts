import "server-only";

import type { AiProviderRequest, AiProviderResult } from "@/lib/ai/ai";

export interface AiProvider {
  generate(request: AiProviderRequest): Promise<AiProviderResult>;
}
