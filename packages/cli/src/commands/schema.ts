import { resultJsonSchema } from '@perftracker/core'

export function runSchema(): string {
  return JSON.stringify(resultJsonSchema(), null, 2)
}
