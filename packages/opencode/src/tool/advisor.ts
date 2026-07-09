import { Effect, Schema } from "effect"
import * as Stream from "effect/Stream"
import { LLMEvent } from "@opencode-ai/llm"
import * as Tool from "./tool"
import DESCRIPTION from "./advisor.txt"
import ADVISOR_SYSTEM from "./advisor-system.txt"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { Agent } from "@/agent/agent"
import { MessageV2 } from "../session/message-v2"

export const Parameters = Schema.Struct({
  question: Schema.String.annotate({
    description:
      "What you are stuck on or the decision you want the advisor to review. Be specific about the tradeoffs, the error, or the plan you are weighing.",
  }),
})

/**
 * Inspired by Anthropic's advisor tool: the main (executor) model consults a
 * stronger advisor model at key decision points. Unlike Anthropic's server-side
 * tool, this runs client-side so it works across every provider — when called it
 * makes a one-shot LLM request against the configured `advisor_model` with the
 * full transcript, and returns the guidance as the tool result.
 */
export const AdvisorTool = Tool.define(
  "advisor",
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const agents = yield* Agent.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const model = yield* provider.getAdvisorModel()
          if (!model) {
            return {
              title: "Advisor unavailable",
              output:
                'No advisor model is configured. Set `advisor_model` (for example "anthropic/claude-opus-4-8") in your opencode config to enable the advisor.',
              metadata: {},
            }
          }

          const lastUser = ctx.messages.findLast((message) => message.info.role === "user")
          if (!lastUser || lastUser.info.role !== "user") {
            return {
              title: "Advisor unavailable",
              output: "The advisor needs an active conversation to review.",
              metadata: {},
            }
          }

          const agent = yield* agents.get(ctx.agent)
          const history = yield* MessageV2.toModelMessagesEffect(ctx.messages, model)
          const advice = yield* llm
            .stream({
              agent,
              user: lastUser.info,
              system: [ADVISOR_SYSTEM],
              small: false,
              tools: {},
              model,
              sessionID: ctx.sessionID,
              retries: 2,
              messages: [...history, { role: "user", content: "Advisor request:\n" + params.question }],
            })
            .pipe(
              Stream.filter(LLMEvent.is.textDelta),
              Stream.map((event) => event.text),
              Stream.mkString,
              Effect.orDie,
            )

          const cleaned = advice.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim()
          const label = `${model.providerID}/${model.id}`
          return {
            title: `Advisor (${label})`,
            output: cleaned || "The advisor returned no guidance.",
            metadata: { model: label },
          }
        }),
    }
  }),
)
