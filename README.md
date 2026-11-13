# World Brief

Pick countries, get an AI summary of their news, and ask the AI questions about it, in English or Hebrew.

- News for each country comes from Google News (no key needed).
- Summaries for **Today**, **2 days** (grouped Today / Yesterday) or a **Week** (top stories plus a day-by-day timeline).
- A chat to ask questions about the news. Answers link to the headlines they used.
- Translate any story or chat answer between English and Hebrew. The whole app also switches to Hebrew (right-to-left).
- Bring your own AI key: **OpenRouter**, **Claude**, **ChatGPT** or **Gemini**.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer. There is nothing to install.

```bash
npm start
```

Then open http://localhost:3000.

## Add your AI key

1. Click the provider button in the top bar (it says "Claude · no key" at first).
2. Paste a key into one of the cards, then click **Test key**.
3. Pick a model from the dropdown. Recommended models are at the top. For OpenRouter there is a **Free models** group (no cost, with daily limits); the default is "Free: best free model available". After a key is saved, the dropdown also lists every model that key can use. Pick "Other…" to type any model name.
4. Click **Use this** on the provider you want.

Where to get a key:

| Provider | Link |
|---|---|
| OpenRouter | https://openrouter.ai/keys |
| Claude | https://console.anthropic.com/settings/keys |
| ChatGPT | https://platform.openai.com/api-keys |
| Gemini | https://aistudio.google.com/apikey |

Keys are saved only in your browser (localStorage). Each request goes from the browser to the small server on your computer, which forwards it straight to the provider you chose.

## Publish on Render (free)

1. Push this project to GitHub.
2. In [Render](https://render.com) choose **New > Blueprint** and pick the repository. `render.yaml` sets everything up.
3. Open the address Render gives you. Each visitor adds their own AI key.

When a host sets `PORT`, the server listens on all addresses so visitors can reach it. Locally it only accepts this computer.

## Files

| File | What it does |
|---|---|
| `server.js` | Serves the app, fetches news, forwards AI requests to the four providers |
| `public/app.js` | The app: countries, news, summaries, chat, translation, settings |
| `public/i18n.js` | English and Hebrew text, provider list and default models |
| `public/countries.js` | Country list with Hebrew names |
| `public/styles.css` | Morning Paper look |

Settings: `PORT` changes the port (default 3000).
