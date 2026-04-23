require("dotenv").config();
const { App } = require("@slack/bolt");
const Anthropic = require("@anthropic-ai/sdk");
const { Client } = require("@notionhq/client");

const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const conversations = {};

const SYSTEM_PROMPT = `Tu es Elabot, un assistant IA sympa et décontracté intégré dans Slack. Tu tutoies toujours. Tu utilises des emojis avec modération. Tu es direct et concis. Quand on te demande de sauvegarder dans Notion, réponds que tu vas le faire et indique [NOTION_SAVE] dans ta réponse. Réponds en français.`;

async function saveToNotion(userId, messages) {
  const pageId = process.env.NOTION_PAGE_ID;
  const date = new Date().toLocaleDateString("fr-FR");
  const userInfo = await slackApp.client.users.info({ user: userId });
  const userName = userInfo.user.real_name || userInfo.user.name;
  const content = messages.map((m) => `${m.role === "user" ? "👤" : "🧚 Elabot"}: ${m.content}`).join("\n\n");
  await notion.pages.create({
    parent: { page_id: pageId },
    properties: { title: { title: [{ text: { content: `${userName} - ${date}` } }] } },
    children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ text: { content: content } }] } }],
  });
}

async function askClaude(userId, userMessage) {
  if (!conversations[userId]) conversations[userId] = [];
  conversations[userId].push({ role: "user", content: userMessage });
  if (conversations[userId].length > 20) conversations[userId] = conversations[userId].slice(-20);
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: conversations[userId],
  });
  const reply = response.content[0].text;
  conversations[userId].push({ role: "assistant", content: reply });
  const wantsNotion = reply.includes("[NOTION_SAVE]");
  const cleanReply = reply.replace("[NOTION_SAVE]", "").trim();
  return { reply: cleanReply, wantsNotion, history: conversations[userId] };
}

slackApp.event("app_mention", async ({ event, say }) => {
  const userId = event.user;
  const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();
  try {
    const { reply, wantsNotion, history } = await askClaude(userId, text);
    if (wantsNotion) {
      await saveToNotion(userId, history);
      await say({ text: reply + "\n\n✅ Conversation sauvegardée dans Notion !", thread_ts: event.ts });
    } else {
      await say({ text: reply, thread_ts: event.ts });
    }
  } catch (err) {
    console.error(err);
    await say({ text: "Oups, quelque chose a planté 😅 Réessaie !", thread_ts: event.ts });
  }
});

slackApp.message(async ({ message, say }) => {
  if (message.subtype || message.bot_id) return;
  const userId = message.user;
  try {
    const { reply, wantsNotion, history } = await askClaude(userId, message.text);
    if (wantsNotion) {
      await saveToNotion(userId, history);
      await say(reply + "\n\n✅ Conversation sauvegardée dans Notion !");
    } else {
      await say(reply);
    }
  } catch (err) {
    console.error(err);
    await say("Oups, quelque chose a planté 😅 Réessaie !");
  }
});

(async () => {
  await slackApp.start(process.env.PORT || 3000);
  console.log("Elabot est en ligne !");
})();
