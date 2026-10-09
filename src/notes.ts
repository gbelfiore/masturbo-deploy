import * as vscode from "vscode";

export async function polishNotesWithLm(draft: string, locale: string): Promise<string | undefined> {
  const lm = (vscode as unknown as { lm?: { selectChatModels: (f?: object) => Thenable<LmModel[]> } }).lm;
  if (!lm?.selectChatModels) {
    return undefined;
  }
  const models = await lm.selectChatModels({ vendor: "copilot" });
  const model = models[0] || (await lm.selectChatModels())[0];
  if (!model) {
    return undefined;
  }
  const language =
    locale === "it" ? "Italian" : locale === "es" ? "Spanish" : locale === "fr" ? "French" : locale === "de" ? "German" : "English";
  const ChatMessage = (
    vscode as unknown as {
      LanguageModelChatMessage: { User: (text: string) => unknown };
    }
  ).LanguageModelChatMessage;
  if (!ChatMessage) {
    return undefined;
  }
  const request = await model.sendRequest(
    [
      ChatMessage.User(
        `Rewrite these release notes in ${language}. Keep markdown. Be concise, no title like "Release notes", no invented features.\n\n${draft}`
      ),
    ],
    {},
    new vscode.CancellationTokenSource().token
  );
  let text = "";
  for await (const chunk of request.text) {
    text += chunk;
  }
  return text.trim() || undefined;
}

type LmModel = {
  sendRequest: (
    messages: unknown[],
    options: object,
    token: vscode.CancellationToken
  ) => Thenable<{ text: AsyncIterable<string> }>;
};
