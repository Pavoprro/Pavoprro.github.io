/**
 * OMEN — concierge backend (Groq, streaming)
 * Cloudflare Worker. Revive el chat /api/concierge del sitio.
 *
 * Habla el MISMO formato SSE que espera el cliente de Kike:
 *   data: {"type":"token","text":"..."}   (por cada chunk)
 *   data: {"type":"done"}                  (al terminar)
 *
 * Secret requerido:  GROQ_API_KEY   (crea uno gratis en console.groq.com)
 * Var opcional:      GROQ_MODEL     (default: llama-3.3-70b-versatile)
 */

const SYSTEM_PROMPT = `Eres el concierge digital de OMEN, una consultora que construye software seguro, audita infraestructura y aplica inteligencia artificial a la operación de negocios (León, México).

Tu trabajo: atender a quien describe su caso, entenderlo en pocas preguntas y proponer, en concreto, cómo OMEN puede ayudar (desarrollo seguro / auditoría IT / automatización con IA). Además, de forma natural, invita a dejar nombre y un medio de contacto (correo o WhatsApp) para que un ingeniero le escriba.

Tono: profesional, directo, cálido, en español. Sin humo, sin promesas vagas, sin sonar a robot de ventas. Respuestas breves (2-4 frases). No inventes precios. Si preguntan por contacto directo: contacto@omen-it.tech o WhatsApp +52 477 406 0808.`;

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Access-Control-Max-Age": "86400",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") {
      return new Response("OMEN concierge — POST {messages} para chatear.", {
        headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    let body = {};
    try { body = await request.json(); } catch (_) {}
    const incoming = Array.isArray(body.messages) ? body.messages : [];
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...incoming
        .filter((m) => m && (m.content || m.text))
        .slice(-16)
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content || m.text || ""),
        })),
    ];

    const enc = new TextEncoder();
    const sse = (obj) => enc.encode("data: " + JSON.stringify(obj) + "\n\n");

    let upstream;
    try {
      upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + env.GROQ_API_KEY,
        },
        body: JSON.stringify({
          model: env.GROQ_MODEL || "llama-3.3-70b-versatile",
          messages,
          stream: true,
          temperature: 0.6,
          max_tokens: 600,
        }),
      });
    } catch (e) {
      return errorStream(sse, cors, "no pude contactar al modelo");
    }

    if (!upstream.ok || !upstream.body) {
      return errorStream(sse, cors, "el modelo respondió " + upstream.status);
    }

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    (async () => {
      const reader = upstream.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const j = JSON.parse(payload);
              const tok = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
              if (tok) await writer.write(sse({ type: "token", text: tok }));
            } catch (_) {}
          }
        }
      } catch (_) {}
      try { await writer.write(sse({ type: "done" })); } catch (_) {}
      try { await writer.close(); } catch (_) {}
    })();

    return new Response(readable, {
      headers: {
        ...cors,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });
  },
};

function errorStream(sse, cors, msg) {
  const body =
    sse({ type: "token", text: "⚠️ " + msg + ". Escríbenos a contacto@omen-it.tech" });
  const done = sse({ type: "done" });
  const stream = new ReadableStream({
    start(c) { c.enqueue(body); c.enqueue(done); c.close(); },
  });
  return new Response(stream, {
    headers: { ...cors, "Content-Type": "text/event-stream; charset=utf-8" },
  });
}
