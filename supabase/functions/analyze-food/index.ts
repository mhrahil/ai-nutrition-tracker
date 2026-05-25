import Anthropic from "npm:@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
const USDA_API_KEY = Deno.env.get("USDA_API_KEY") ?? "DEMO_KEY";

interface FoodItem {
  food_name: string;
  portion_description: string;
  estimated_grams: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  confidence: "high" | "medium" | "low";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { photo_url } = await req.json();

    if (!photo_url) {
      return Response.json({ error: "photo_url is required" }, { status: 400, headers: corsHeaders });
    }

    // Step 1: fetch image and convert to base64
    const imageRes = await fetch(photo_url);
    const imageBuffer = await imageRes.arrayBuffer();
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
    const mediaType = (imageRes.headers.get("content-type") ?? "image/jpeg") as
      | "image/jpeg"
      | "image/png"
      | "image/webp"
      | "image/gif";

    // Step 2: Claude Vision identifies food items
    const claudeResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: `You are a nutrition expert and food recognition AI specialising in Indian,
Middle Eastern, and Australian cuisines as well as Western foods.
Common dishes include: biryani, dal, butter chicken, roti, naan, paneer dishes,
samosas, hummus, falafel, shawarma, kebabs, tabbouleh, meat pies, and standard
Western proteins and grains.
Return ONLY valid JSON — no markdown formatting, no explanation outside the JSON array.`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64Image },
            },
            {
              type: "text",
              text: `Identify every food item visible in this image. For each item return:
- food_name: specific name (e.g. "butter chicken curry", not just "curry")
- portion_description: human-readable estimate ("1 cup ~200g", "1 medium roti ~60g")
- estimated_grams: best weight estimate as a number
- calories: estimated total calories for this portion
- protein_g: grams of protein
- carbs_g: grams of carbohydrates
- fat_g: grams of fat
- confidence: "high" if you're confident, "medium" if uncertain, "low" if guessing

Return a JSON array: [{ food_name, portion_description, estimated_grams, calories, protein_g, carbs_g, fat_g, confidence }]`,
            },
          ],
        },
      ],
    });

    const rawText = claudeResponse.content[0].type === "text" ? claudeResponse.content[0].text : "[]";
    let foods: FoodItem[] = JSON.parse(rawText);

    // Step 3: Try USDA lookup for accuracy boost, fall back to Open Food Facts
    foods = await Promise.all(
      foods.map(async (food) => {
        const usda = await lookupUSDA(food.food_name, food.estimated_grams);
        if (usda) return { ...food, ...usda };

        const off = await lookupOpenFoodFacts(food.food_name, food.estimated_grams);
        if (off) return { ...food, ...off };

        return food; // keep Claude's estimates
      })
    );

    return Response.json({ foods }, { headers: corsHeaders });
  } catch (error) {
    console.error("analyze-food error:", error);
    return Response.json({ error: String(error) }, { status: 500, headers: corsHeaders });
  }
});

async function lookupUSDA(
  foodName: string,
  grams: number
): Promise<Partial<FoodItem> | null> {
  try {
    const res = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(foodName)}&dataType=Foundation,SR+Legacy&pageSize=1&api_key=${USDA_API_KEY}`
    );
    const data = await res.json();
    const food = data.foods?.[0];
    if (!food) return null;

    const getPer100g = (nutrientId: number) =>
      food.foodNutrients?.find((n: { nutrientId: number }) => n.nutrientId === nutrientId)?.value ?? 0;

    const factor = grams / 100;
    return {
      calories:   Math.round(getPer100g(1008) * factor),
      protein_g:  Math.round(getPer100g(1003) * factor * 10) / 10,
      carbs_g:    Math.round(getPer100g(1005) * factor * 10) / 10,
      fat_g:      Math.round(getPer100g(1004) * factor * 10) / 10,
    };
  } catch {
    return null;
  }
}

async function lookupOpenFoodFacts(
  foodName: string,
  grams: number
): Promise<Partial<FoodItem> | null> {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(foodName)}&json=1&page_size=1&fields=nutriments`
    );
    const data = await res.json();
    const product = data.products?.[0];
    if (!product?.nutriments) return null;

    const n = product.nutriments;
    const factor = grams / 100;
    return {
      calories:   Math.round((n["energy-kcal_100g"] ?? 0) * factor),
      protein_g:  Math.round((n["proteins_100g"]    ?? 0) * factor * 10) / 10,
      carbs_g:    Math.round((n["carbohydrates_100g"] ?? 0) * factor * 10) / 10,
      fat_g:      Math.round((n["fat_100g"]          ?? 0) * factor * 10) / 10,
    };
  } catch {
    return null;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
