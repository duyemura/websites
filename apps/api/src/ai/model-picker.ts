import type { Config } from "../plugins/env";

/**
 * Task tags for the AI-assisted site-building pipeline.
 *
 * Each tag maps to a configured model. This keeps agent code decoupled from
 * specific model names so we can retarget tasks without touching callers.
 */
export type LlmTask =
  | "default"
  | "vision"
  | "cheap"
  | "code"
  | "long_context"
  | "reasoning";

/**
 * Maps an LLM task to the model name configured for it.
 */
export function modelForTask(task: LlmTask, config: Config): string {
  switch (task) {
    case "vision":
      return config.VISION_LLM_MODEL;
    case "cheap":
      return config.CHEAP_LLM_MODEL;
    case "code":
      return config.CODE_LLM_MODEL;
    case "long_context":
      return config.LONG_CONTEXT_LLM_MODEL;
    case "reasoning":
      return config.REASONING_LLM_MODEL;
    case "default":
    default:
      return config.DEFAULT_LLM_MODEL;
  }
}

/**
 * Convenience mapping from agent names to LLM tasks.
 *
 * Keep this in sync with the agent definitions in the site-building pipeline.
 */
export const AGENT_TASK_MAP: Record<string, LlmTask> = {
  "gmb-interpreter": "cheap",
  "ingestion-synthesizer": "cheap",
  "site-strategist": "default",
  "sitemap-architect": "default",
  "brand-extractor": "default",
  copywriter: "default",
  "seo-strategist": "default",
  "section-designer": "default",
  "astro-coder": "code",
  "asset-curator": "vision",
  "visual-qa": "vision",
  "code-reviewer": "code",
  "consistency-checker": "cheap",
  "site-assistant": "default",
  "memory-keeper": "default",
  "whole-site-reviewer": "long_context",
  "orchestrator-intent": "cheap",
};

/**
 * Returns the model a named agent should use.
 */
export function modelForAgent(agentName: string, config: Config): string {
  const task = AGENT_TASK_MAP[agentName] ?? "default";
  return modelForTask(task, config);
}
