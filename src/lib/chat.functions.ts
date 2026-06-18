import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Mock AI reply — Gemini API beillesztése később.
 * Egyelőre visszhangoz + egy fix bevezetővel válaszol, hogy a teljes pipeline
 * (üzenet küldés → DB → UI streaming) működjön kulcs nélkül is.
 */
export const generateMockReply = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        userText: z.string().min(1),
        workflowId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    // Szándékos rövid késleltetés, hogy lássuk a "thinking" állapotot.
    await new Promise((r) => setTimeout(r, 600));

    const reply =
      `_(Mock válasz — Gemini később kerül bekötésre.)_\n\n` +
      `Megkaptam: **"${data.userText}"**\n\n` +
      `Ez egy fejlesztői visszhang. Amint beadod a Gemini API kulcsot, ` +
      `ide kerül a valódi modell válasza, amely a workflow tanításához ` +
      `kérdéseket fog feltenni (cél platform, fiók, ütemezés, kill switch stb.).`;

    return { reply };
  });
