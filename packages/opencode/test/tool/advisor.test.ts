import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"
import { Config } from "@/config/config"
import { Agent } from "@/agent/agent"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"

afterEach(async () => {
  delete process.env["OPENCODE_DISABLE_ADVISOR"]
  await disposeAllInstances()
})

const root = LayerNode.group([ToolRegistry.node, Agent.node])

function configWith(advisorModel?: string) {
  return TestConfig.layer({
    get: () => Effect.succeed(advisorModel ? { advisor_model: advisorModel } : {}),
    directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
  })
}

const withAdvisor = testEffect(
  LayerNode.compile(root, [
    [Config.node, configWith("anthropic/claude-opus-4-8")],
    [RuntimeFlags.node, RuntimeFlags.layer()],
  ]),
)

const withoutAdvisor = testEffect(
  LayerNode.compile(root, [
    [Config.node, configWith()],
    [RuntimeFlags.node, RuntimeFlags.layer()],
  ]),
)

describe("advisor tool gating", () => {
  withAdvisor("registers the advisor tool when advisor_model is configured", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).toContain("advisor")
    }),
  )

  withoutAdvisor("hides the advisor tool when advisor_model is unset", () =>
    Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).not.toContain("advisor")
    }),
  )

  withAdvisor("hides the advisor tool when OPENCODE_DISABLE_ADVISOR is set", () =>
    Effect.gen(function* () {
      process.env["OPENCODE_DISABLE_ADVISOR"] = "1"
      const registry = yield* ToolRegistry.Service
      const ids = yield* registry.ids()
      expect(ids).not.toContain("advisor")
    }),
  )
})
