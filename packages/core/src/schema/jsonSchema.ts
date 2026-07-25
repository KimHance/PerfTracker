import { z } from 'zod'
import { ResultSchema } from './result.js'

/** CI 검증과 LLM 계약용 JSON Schema. perftracker schema 가 이것을 그대로 출력한다. */
export function resultJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ResultSchema) as Record<string, unknown>
}
