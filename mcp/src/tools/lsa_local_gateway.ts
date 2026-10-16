import {
  GATEWAY_PROTOCOL,
  TokenStore,
  type AnalyzeCommandResult,
  type ExecuteCommandResult,
} from "@infrafast/stage-command-core";
import { z } from "zod";
import { text, type ToolDefinition } from "../mcpCompat.js";
import {
  getNativeClient,
  type QlcNativeClient,
} from "../qlc/nativeClient.js";
import {
  exactNativeCaptionKey,
  type NativeWidget,
} from "../qlc/nativeInventory.js";

type QlcPlan =
  | { kind: "state" }
  | { kind: "list" }
  | {
      kind: "button";
      caption: string;
      inventoryGeneration: number;
    };

interface QlcContinuation {
  kind: "button";
  inventoryGeneration: number;
  candidates: string[];
}

const AnalyzeInputSchema = z.object({
  protocol: z.literal(GATEWAY_PROTOCOL),
  text: z.string().min(1).max(500),
  locale: z.string().optional(),
  continuationToken: z.string().optional(),
  context: z.object({}).passthrough().optional(),
});

const ExecuteInputSchema = z.object({
  protocol: z.literal(GATEWAY_PROTOCOL),
  planToken: z.string().min(1),
});

function cloneButton(widget: NativeWidget): NativeWidget {
  return {...widget, framePath: [...widget.framePath]};
}

function jsonResult(value: AnalyzeCommandResult | ExecuteCommandResult) {
  return text(JSON.stringify(value));
}

function rawCaptionAfterPrefix(raw: string): string | null {
  const patterns = [
    /^\s*qlc\s*[,;:]?\s+(?:appuie\s+sur\s+(?:le\s+bouton\s+)?|presse\s+(?:le\s+bouton\s+)?|bouton\s+)?(.+?)\s*$/iu,
    /^\s*(?:appuie\s+sur|presse)\s+(?:le\s+bouton\s+)?qlc\s*[,;:]?\s+(.+?)\s*$/iu,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function spokenCaptionVariants(raw: string): string[] {
  const exact = raw.trim();
  if (!exact) return [];

  const variants = [exact];
  const withoutSentencePunctuation = exact.replace(/[.!?…]+$/u, "").trim();
  if (
    withoutSentencePunctuation &&
    exactNativeCaptionKey(withoutSentencePunctuation) !== exactNativeCaptionKey(exact)
  ) {
    variants.push(withoutSentencePunctuation);
  }
  return variants;
}

function findExactSpokenButton(
  client: QlcNativeClient,
  rawCaption: string,
): { widget: NativeWidget | null; requested: string } {
  const buttons = client.listWidgets().filter((widget) => widget.kind === "button");
  for (const requested of spokenCaptionVariants(rawCaption)) {
    const key = exactNativeCaptionKey(requested);
    const widget = buttons.find(
      (candidate) => exactNativeCaptionKey(candidate.caption) === key,
    );
    if (widget) return { widget, requested };
  }
  const variants = spokenCaptionVariants(rawCaption);
  return { widget: null, requested: variants.at(-1) ?? rawCaption.trim() };
}

function normalizedWords(value: string): string {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("fr-FR")
    .trim()
    .replace(/\s+/gu, " ");
}

function isStateCommand(raw: string): boolean {
  const value = normalizedWords(raw);
  return [
    "qlc état",
    "qlc etat",
    "état qlc",
    "etat qlc",
    "qlc statut",
    "statut qlc",
    "qlc status",
    "status qlc",
  ].includes(value);
}

function isListCommand(raw: string): boolean {
  const value = normalizedWords(raw);
  return (
    /^(?:qlc\s+)?liste(?:\s+(?:moi\s+)?(?:tous\s+les\s+)?(?:contrôles|controles|boutons|widgets))?(?:\s+qlc)?$/u.test(value) ||
    /^(?:quels|quelles)\s+(?:sont\s+)?(?:les\s+)?(?:contrôles|controles|boutons|widgets)\s+qlc$/u.test(value)
  );
}

function candidateCaptions(client: QlcNativeClient, requested: string): string[] {
  const needle = exactNativeCaptionKey(requested);
  if (!needle) return [];
  return client
    .listWidgets()
    .filter((widget) => widget.kind === "button")
    .filter((widget) => exactNativeCaptionKey(widget.caption).includes(needle))
    .map((widget) => widget.caption)
    .slice(0, 8);
}

export class QlcLocalCommandGateway {
  private readonly store = new TokenStore<QlcPlan, QlcContinuation>({
    defaultTtlMs: 30_000,
  });

  constructor(
    private readonly getClient: () => QlcNativeClient | null = getNativeClient,
  ) {}

  analyze(input: z.infer<typeof AnalyzeInputSchema>): AnalyzeCommandResult {
    if (input.continuationToken) {
      return this.continueButton(input.text, input.continuationToken);
    }

    if (isStateCommand(input.text)) {
      const stored = this.store.createPlan({kind: "state"}, "read");
      return {
        protocol: GATEWAY_PROTOCOL,
        recognized: true,
        status: "ready",
        effect: "read",
        planToken: stored.token,
        expiresInMs: stored.expiresInMs,
        responseText: null,
      };
    }

    if (isListCommand(input.text)) {
      const stored = this.store.createPlan({kind: "list"}, "read");
      return {
        protocol: GATEWAY_PROTOCOL,
        recognized: true,
        status: "ready",
        effect: "read",
        planToken: stored.token,
        expiresInMs: stored.expiresInMs,
        responseText: null,
      };
    }

    const requestedCaption = rawCaptionAfterPrefix(input.text);
    if (!requestedCaption) {
      return {
        protocol: GATEWAY_PROTOCOL,
        recognized: false,
        status: "unrecognized",
        effect: "none",
      };
    }

    const client = this.getClient();
    const state = client?.getState();
    if (!client || !state?.ready) {
      return {
        protocol: GATEWAY_PROTOCOL,
        recognized: true,
        status: "clarification",
        effect: "none",
        ...this.continuation(
          {
            kind: "button",
            inventoryGeneration: state?.inventoryGeneration ?? -1,
            candidates: [],
          },
          `QLC+ n'est pas prêt (état : ${state?.state ?? "non initialisé"}).`,
        ),
      };
    }

    const exactResolution = findExactSpokenButton(client, requestedCaption);
    const exactButton = exactResolution.widget;

    if (exactButton) {
      const stored = this.store.createPlan(
        {
          kind: "button",
          caption: exactButton.caption,
          inventoryGeneration: state.inventoryGeneration,
        },
        "write",
      );
      return {
        protocol: GATEWAY_PROTOCOL,
        recognized: true,
        status: "ready",
        effect: "write",
        planToken: stored.token,
        expiresInMs: stored.expiresInMs,
        responseText: null,
      };
    }

    const candidates = candidateCaptions(client, exactResolution.requested);
    const message =
      candidates.length === 0
        ? `Aucun bouton QLC+ ne correspond exactement à « ${exactResolution.requested} ».`
        : `Aucun bouton exact « ${exactResolution.requested} ». Correspondances possibles : ${candidates.join(", ")}. Lequel veux-tu utiliser ?`;

    return {
      protocol: GATEWAY_PROTOCOL,
      recognized: true,
      status: "clarification",
      effect: "none",
      ...this.continuation(
        {
          kind: "button",
          inventoryGeneration: state.inventoryGeneration,
          candidates,
        },
        message,
      ),
    };
  }

  async execute(planToken: string): Promise<ExecuteCommandResult> {
    const client = this.getClient();
    const currentGeneration = client?.getState().inventoryGeneration;

    const taken = this.store.takePlan(planToken, (plan) => {
      if (plan.kind !== "button") return false;
      return currentGeneration !== plan.inventoryGeneration;
    });

    if (!taken.ok) {
      return {
        protocol: GATEWAY_PROTOCOL,
        ok: false,
        errorCode: taken.error,
        responseText:
          taken.error === "stale_plan"
            ? "Le projet QLC+ a changé. La commande n'a pas été exécutée."
            : "Cette commande QLC+ n'est plus valide.",
      };
    }

    const plan = taken.value;
    if (plan.kind === "state") {
      const state = client?.getState();
      if (!state) {
        return {
          protocol: GATEWAY_PROTOCOL,
          ok: true,
          responseText: "Le client QLC+ n'est pas initialisé.",
        };
      }
      return {
        protocol: GATEWAY_PROTOCOL,
        ok: true,
        responseText: state.ready
          ? `QLC+ est prêt avec ${state.widgetCount} contrôles chargés.`
          : `QLC+ est dans l'état ${state.state}.`,
      };
    }

    if (plan.kind === "list") {
      const state = client?.getState();
      if (!client || !state?.ready) {
        return {
          protocol: GATEWAY_PROTOCOL,
          ok: true,
          responseText: `QLC+ n'est pas prêt (état : ${state?.state ?? "non initialisé"}).`,
        };
      }
      const captions = client
        .listWidgets()
        .filter((widget) => widget.kind === "button")
        .map((widget) => widget.caption);
      return {
        protocol: GATEWAY_PROTOCOL,
        ok: true,
        responseText:
          captions.length === 0
            ? "Aucun bouton QLC+ n'est disponible."
            : `Boutons QLC+ : ${captions.join(", ")}.`,
      };
    }

    if (!client) {
      return {
        protocol: GATEWAY_PROTOCOL,
        ok: false,
        errorCode: "execution_failed",
        responseText: "Le client QLC+ n'est pas initialisé.",
      };
    }

    try {
      const widget = cloneButton(await client.pressButton(plan.caption));
      return {
        protocol: GATEWAY_PROTOCOL,
        ok: true,
        responseText: `Commande ${widget.caption} envoyée.`,
      };
    } catch {
      return {
        protocol: GATEWAY_PROTOCOL,
        ok: false,
        errorCode: "execution_failed",
        responseText: `La commande QLC+ ${plan.caption} n'a pas pu être envoyée.`,
      };
    }
  }

  private continueButton(
    rawReply: string,
    token: string,
  ): AnalyzeCommandResult {
    const continuation = this.store.takeContinuation(token);
    if (!continuation.ok) {
      return {
        protocol: GATEWAY_PROTOCOL,
        recognized: false,
        status: "unrecognized",
        effect: "none",
        responseText: "Cette clarification QLC+ n'est plus valide.",
      };
    }

    const client = this.getClient();
    const state = client?.getState();
    if (
      !client ||
      !state?.ready ||
      state.inventoryGeneration !== continuation.value.inventoryGeneration
    ) {
      return {
        protocol: GATEWAY_PROTOCOL,
        recognized: false,
        status: "unrecognized",
        effect: "none",
        responseText: "Le projet QLC+ a changé. Recommence la commande.",
      };
    }

    const allowed =
      continuation.value.candidates.length > 0
        ? continuation.value.candidates
        : client
            .listWidgets()
            .filter((widget) => widget.kind === "button")
            .map((widget) => widget.caption);
    const caption = spokenCaptionVariants(rawReply)
      .map((reply) =>
        allowed.find(
          (candidate) =>
            exactNativeCaptionKey(candidate) === exactNativeCaptionKey(reply),
        ),
      )
      .find((candidate): candidate is string => Boolean(candidate));

    if (!caption) {
      return {
        protocol: GATEWAY_PROTOCOL,
        recognized: false,
        status: "unrecognized",
        effect: "none",
        responseText: "La réponse ne correspond pas exactement à un bouton QLC+ proposé.",
      };
    }

    const stored = this.store.createPlan(
      {
        kind: "button",
        caption,
        inventoryGeneration: state.inventoryGeneration,
      },
      "write",
    );
    return {
      protocol: GATEWAY_PROTOCOL,
      recognized: true,
      status: "ready",
      effect: "write",
      planToken: stored.token,
      expiresInMs: stored.expiresInMs,
      responseText: null,
    };
  }

  private continuation(value: QlcContinuation, responseText: string) {
    const stored = this.store.createContinuation(value);
    return {
      continuationToken: stored.token,
      expiresInMs: stored.expiresInMs,
      responseText,
    };
  }
}

export function createQlcLocalGatewayTools(
  gateway = new QlcLocalCommandGateway(),
): ToolDefinition[] {
  return [
    {
      name: "lsa_local_analyze_command",
      description:
        "Analyze one Local LSA natural command for QLC+ without side effects.",
      schema: AnalyzeInputSchema,
      cb: async (input: unknown) =>
        jsonResult(gateway.analyze(AnalyzeInputSchema.parse(input))),
    },
    {
      name: "lsa_local_execute_command",
      description:
        "Execute one previously analyzed Local LSA QLC+ command plan.",
      schema: ExecuteInputSchema,
      cb: async (input: unknown) => {
        const parsed = ExecuteInputSchema.parse(input);
        return jsonResult(await gateway.execute(parsed.planToken));
      },
    },
  ];
}
