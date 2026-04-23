require("dotenv").config();
const { App } = require("@slack/bolt");
const Anthropic = require("@anthropic-ai/sdk");
const { Client } = require("@notionhq/client");

// ── Clients ────────────────────────────────────────────────────────────────
const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const notion = new Client({ auth: process.env.NOTION_TOKEN });

// Mémoire des conversations (par utilisateur / canal)
const conversations = {};

// ── Prompt système ─────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Tu es Elabot 🧚, un assistant IA sympa et décontracté intégré dans Slack.
Tu es comme ce collègue cool qui connaît tout et aide sans se prendre au sérieux.

Ton style :
- Tu parles de façon naturelle et détendue, tu tutoies toujours
- Tu utilises des emojis avec modération
- Tu es direct et concis
- Si tu ne sais pas quelque chose, tu le dis franchement

Quand on te demande de sauvegarder dans Notion (ou "archive", "note ça", "enregistre"),
réponds que tu vas le faire et indique-le clairement dans ta réponse avec le mot-clé [NOTION_SAVE].

Réponds en français sauf si on te parle dans une autre langue.`;

// ── Sauvegarder dans Notion ────────────────────────────────────────────────
async function saveToNotion(userId, channelId, messages) {
  const pageId = process.env.NOTION_PAGE_ID;
  const date = new Date().toLocaleDateString("fr-FR");
const userInfo = await slackApp.client.users.info({ user: userId });
  const userName = userInfo.user.real_name || userInfo.user.name;
  const content = messages
    .map((m) => `${m.role === "user" ? "👤" : "🧚 Elabot"}: ${m.content}`)
    .join("\n\n");

  await notion.pages.create({
    parent: { page_id: pageId },
    properties: {
      title: {
        title: [{ text: {content: `${userName} — ${date}`,
      },
    },
    children: [
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: [{ text: { content: `📅 ${date} · Utilisateur ${userId}` } }] },
      },
      {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ text: { content: content } }] },
      },
    ],
  });
}

// ── Appel Claude ───────────────────────────────────────────────────────────
async function askClaude(userId, userMessage) {
  if (!conversations[userId]) conversations[userId] = [];
  conversations[userId].push({ role: "user", content: userMessage });

  // Limiter l'historique à 20 messages
  if (conversations[userId].length > 20) {
    conversations[userId] = conversations[userId].slice(-20);
  }

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

// ── Gérer les mentions (@Elabot dans un canal) ─────────────────────────────
slackApp.event("app_mention", async ({ event, say }) => {
  const userId = event.user;
  const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim(); // retire la mention

  try {
    await say({ text: "🧚 Je réfléchis...", thread_ts: event.ts });
    const { reply, wantsNotion, history } = await askClaude(userId, text);

    if (wantsNotion) {
      await saveToNotion(userId, event.channel, history);
      await say({ text: reply + "\n\n✅ Conversation sauvegardée dans Notion !", thread_ts: event.ts });
    } else {
      await say({ text: reply, thread_ts: event.ts });
    }
  } catch (err) {
    console.error(err);
    await say({ text: "Oups, quelque chose a planté 😅 Réessaie !", thread_ts: event.ts });
  }
});

// ── Gérer les messages directs ────────────────────────────────────────────
slackApp.message(async ({ message, say }) => {
  if (message.subtype || message.bot_id) return; // ignore les messages de bots
  const userId = message.user;

  try {
    const { reply, wantsNotion, history } = await askClaude(userId, message.text);

    if (wantsNotion) {
      await saveToNotion(userId, message.channel, history);
      await say(reply + "\n\n✅ Conversation sauvegardée dans Notion !");
    } else {
      await say(reply);
    }
  } catch (err) {
    console.error(err);
    await say("Oups, quelque chose a planté 😅 Réessaie !");
  }
});

// ── Démarrage ─────────────────────────────────────────────────────────────
(async () => {
  await slackApp.start(process.env.PORT || 3000);
  console.log("⚡️ Elabot 🧚 est en ligne sur le port", process.env.PORT || 3000);
})();
