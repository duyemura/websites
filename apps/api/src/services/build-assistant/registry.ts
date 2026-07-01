import type { BuildAssistantAction, AssistantContext } from "./types";
import { EditPageAction } from "./actions/edit-page";
import { ApprovePageAction } from "./actions/approve-page";
import { PublishPageAction } from "./actions/publish-page";
import { PreviewInfoAction } from "./actions/preview-info";
import { HelpAction } from "./actions/help";

const actions: BuildAssistantAction[] = [
  new ApprovePageAction(),
  new PublishPageAction(),
  new PreviewInfoAction(),
  new EditPageAction(),
  new HelpAction(),
];

export async function resolveBuildCommand(
  message: string,
  ctx: AssistantContext,
): Promise<BuildAssistantAction> {
  for (const action of actions) {
    if (await action.canHandle(message, ctx)) {
      return action;
    }
  }
  return new HelpAction();
}
