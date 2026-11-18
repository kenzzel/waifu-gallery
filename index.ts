import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonObject = Record<string, unknown>;

function json(body: JsonObject, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function cleanMimeType(value: unknown): string {
  return String(value || "image/jpeg")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method tidak diizinkan. Gunakan POST." }, 405);
  }

  try {
    // 1. Ambil konfigurasi server.
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey =
      Deno.env.get("SUPABASE_ANON_KEY") ||
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const configuredModel = Deno.env.get("GEMINI_MODEL")?.trim();
    const model = configuredModel || "gemini-2.5-flash";

    if (!supabaseUrl || !anonKey) {
      console.error("Missing Supabase URL or anon/publishable key secret.");
      return json({
        error: "Konfigurasi Supabase belum lengkap.",
        detail: "Pastikan SUPABASE_URL dan SUPABASE_ANON_KEY tersedia di Edge Function Secrets.",
      }, 500);
    }

    if (!serviceRoleKey) {
      console.error("Missing SUPABASE_SERVICE_ROLE_KEY secret.");
      return json({
        error: "Secret SUPABASE_SERVICE_ROLE_KEY belum tersedia di Edge Function.",
      }, 500);
    }

    if (!geminiKey) {
      console.error("Missing GEMINI_API_KEY secret.");
      return json({
        error: "Secret GEMINI_API_KEY belum diatur di Edge Function.",
      }, 500);
    }

    // 2. Validasi sesi pengguna dari Authorization Bearer token.
    const authorization = req.headers.get("Authorization");
    if (!authorization) {
      return json({ error: "Token login tidak ditemukan. Silakan login ulang." }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) {
      console.error("Authentication failed:", authError?.message || "No user returned");
      return json({
        error: "Sesi login tidak valid. Silakan keluar lalu login kembali.",
        detail: authError?.message || null,
      }, 401);
    }

    // Admin client hanya dipakai di server untuk cek role, mengambil file,
    // dan menyimpan hasil analisis. Service role tidak pernah dikirim ke browser.
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 3. Baca request body.
    let body: JsonObject;
    try {
      body = await req.json() as JsonObject;
    } catch {
      return json({ error: "Request body bukan JSON yang valid." }, 400);
    }

    const wallpaperId = body.wallpaper_id ? String(body.wallpaper_id).trim() : "";
    let imageBase64 = String(body.image_base64 || "").trim();
    let mimeType = cleanMimeType(body.mime_type);

    // Mendukung data URL jika suatu saat frontend mengirimkannya.
    if (imageBase64.startsWith("data:")) {
      const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
      if (!match) {
        return json({ error: "Format data URL gambar tidak valid." }, 400);
      }
      mimeType = cleanMimeType(match[1]);
      imageBase64 = match[2];
    }

    // 4. Jika wallpaper_id dikirim, ini adalah proses indeks foto lama.
    if (wallpaperId) {
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("id, role")
        .eq("id", authData.user.id)
        .maybeSingle();

      if (profileError) {
        console.error("Owner role lookup failed:", profileError.message);
        return json({
          error: "Gagal memeriksa role akun Owner.",
          detail: profileError.message,
        }, 500);
      }

      const role = String(profile?.role || "").trim().toLowerCase();
      if (role !== "owner") {
        return json({
          error: "Hanya Owner yang boleh mengindeks foto lama.",
          detected_role: role || "kosong",
          user_id: authData.user.id,
        }, 403);
      }

      const storagePath = String(body.storage_path || "").trim();
      if (
        !storagePath ||
        storagePath.startsWith("/") ||
        storagePath.includes("..") ||
        storagePath.includes("\\")
      ) {
        return json({ error: "Storage path foto tidak valid." }, 400);
      }

      // Gunakan Storage SDK dengan service role, bukan URL publik yang dibentuk manual.
      const { data: imageFile, error: storageError } = await admin.storage
        .from("wallpapers")
        .download(storagePath);

      if (storageError || !imageFile) {
        console.error("Storage download failed:", storageError?.message || "No file returned", storagePath);
        return json({
          error: "Gagal mengambil foto dari bucket wallpapers.",
          detail: storageError?.message || "File tidak ditemukan.",
          storage_path: storagePath,
        }, 400);
      }

      if (imageFile.size > 10 * 1024 * 1024) {
        return json({ error: "Ukuran foto melebihi batas 10 MB." }, 413);
      }

      mimeType = cleanMimeType(imageFile.type || mimeType);
      imageBase64 = bytesToBase64(new Uint8Array(await imageFile.arrayBuffer()));
    }

    // 5. Validasi file sebelum dikirim ke Gemini.
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!imageBase64) {
      return json({ error: "Data gambar kosong. Tidak ada foto untuk dianalisis." }, 400);
    }
    if (!allowedMimeTypes.includes(mimeType)) {
      return json({
        error: "Format gambar tidak didukung.",
        detail: `Format diterima: JPG, PNG, WEBP. Format yang diterima server: ${mimeType}`,
      }, 400);
    }
    if (imageBase64.length > 15_000_000) {
      return json({ error: "Gambar terlalu besar untuk dianalisis." }, 413);
    }

    // 6. Prompt pencarian visual. Jangan menebak nama karakter jika tidak jelas.
    const prompt = `You are an image indexing assistant for an anime illustration gallery. Analyze the actual visual content of the image, not the filename or caption. Return valid JSON only with two fields: visual_tags (an array of up to 24 short searchable labels) and visual_description (one short factual sentence). If an anime character is clearly recognizable, include the character's canonical name and common spelling variants in visual_tags. If uncertain, do not guess a character name; describe visible traits instead. Include relevant objects, clothing, hair color, eye color, expressions, art style, background, and scene concepts. Use useful Indonesian and English search terms where appropriate. Do not invent an anime title or character. Example tags may include elaina, silver-haired anime girl, witch hat, blue eyes, black cat, white hair, anime illustration.`;

    // 7. Kirim gambar ke Gemini. Pakai header API key agar tidak muncul di URL/log.
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    let aiResponse: Response;
    try {
      aiResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiKey,
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: imageBase64,
                },
              },
            ],
          }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2,
          },
        }),
      });
    } catch (networkError) {
      console.error("Gemini network request failed:", errorMessage(networkError));
      return json({
        error: "Tidak dapat terhubung ke layanan Gemini.",
        detail: errorMessage(networkError),
        model,
      }, 502);
    }

    const aiResponseText = await aiResponse.text();
    let aiJson: JsonObject = {};
    try {
      aiJson = aiResponseText ? JSON.parse(aiResponseText) as JsonObject : {};
    } catch {
      console.error("Gemini returned non-JSON response:", aiResponse.status, aiResponseText.slice(0, 1000));
      return json({
        error: "Gemini mengirim respons yang bukan JSON.",
        detail: aiResponseText.slice(0, 1000),
        status: aiResponse.status,
        model,
      }, 502);
    }

    if (!aiResponse.ok) {
      const geminiError = (aiJson.error as JsonObject | undefined)?.message;
      const detail = String(geminiError || aiResponseText || "Tidak ada detail dari Gemini");
      console.error("Gemini API error:", {
        status: aiResponse.status,
        model,
        detail,
      });
      return json({
        error: `Gemini API gagal (${aiResponse.status}) pada model ${model}: ${detail}`,
        status: aiResponse.status,
        model,
      }, 502);
    }

    // 8. Ambil teks hasil analisis.
    const candidates = Array.isArray(aiJson.candidates) ? aiJson.candidates : [];
    const firstCandidate = candidates[0] as JsonObject | undefined;
    const content = firstCandidate?.content as JsonObject | undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const generatedText = parts
      .map((part) => String((part as JsonObject).text || ""))
      .join("")
      .trim();

    if (!generatedText) {
      const blockReason = (aiJson.promptFeedback as JsonObject | undefined)?.blockReason;
      console.error("Gemini returned no candidate text:", JSON.stringify(aiJson).slice(0, 1500));
      return json({
        error: "Gemini tidak menghasilkan teks analisis.",
        detail: blockReason ? `Prompt diblokir: ${String(blockReason)}` : "Respons Gemini tidak memiliki candidates/content/parts.",
        model,
      }, 502);
    }

    let parsed: JsonObject;
    try {
      parsed = JSON.parse(generatedText) as JsonObject;
    } catch {
      console.error("Could not parse Gemini JSON:", generatedText.slice(0, 1000));
      return json({
        error: "Format hasil analisis Gemini tidak valid.",
        detail: generatedText.slice(0, 1000),
      }, 502);
    }

    const rawTags = Array.isArray(parsed.visual_tags) ? parsed.visual_tags : [];
    const visualTags = [
      ...new Set(
        rawTags
          .map((tag) => String(tag).trim().toLowerCase())
          .filter((tag) => tag.length > 0)
      ),
    ].slice(0, 24);

    const visualDescription = String(parsed.visual_description || "").trim().slice(0, 700);

    if (visualTags.length === 0) {
      return json({
        error: "Gemini berhasil merespons tetapi tidak menghasilkan kata kunci visual.",
        detail: generatedText.slice(0, 1000),
      }, 502);
    }

    // 9. Simpan indeks untuk foto lama. Foto upload baru menerima tags dari caller.
    if (wallpaperId) {
      const { error: updateError } = await admin
        .from("wallpapers")
        .update({
          visual_tags: visualTags,
          visual_description: visualDescription || null,
        })
        .eq("id", wallpaperId);

      if (updateError) {
        console.error("Saving visual index failed:", updateError.message, wallpaperId);
        return json({
          error: "Analisis berhasil, tetapi hasilnya gagal disimpan ke database.",
          detail: updateError.message,
          wallpaper_id: wallpaperId,
        }, 500);
      }
    }

    console.log("Image analyzed successfully:", {
      wallpaperId: wallpaperId || null,
      userId: authData.user.id,
      model,
      tagsCount: visualTags.length,
    });

    return json({
      success: true,
      visual_tags: visualTags,
      visual_description: visualDescription,
      wallpaper_id: wallpaperId || null,
      model,
    });
  } catch (error) {
    console.error("analyze-image unhandled error:", error);
    return json({
      error: "Terjadi kesalahan saat menganalisis gambar.",
      detail: errorMessage(error),
    }, 500);
  }
});
