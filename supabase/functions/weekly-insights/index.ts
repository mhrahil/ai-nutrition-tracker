import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js";

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { user_id } = await req.json();
    if (!user_id) {
      return Response.json({ error: "user_id is required" }, { status: 400, headers: corsHeaders });
    }

    const [summaries, profile, weights] = await Promise.all([
      fetchDailySummaries(user_id),
      fetchUserProfile(user_id),
      fetchRecentWeights(user_id),
    ]);

    if (!profile) {
      return Response.json({ insights: [] }, { headers: corsHeaders });
    }

    if (summaries.length === 0) {
      return Response.json({
        insights: ["Start logging meals to get personalised weekly insights."],
      }, { headers: corsHeaders });
    }

    const insights = await generateInsights(summaries, profile, weights);
    return Response.json({ insights }, { headers: corsHeaders });

  } catch (error) {
    console.error("weekly-insights error:", error);
    return Response.json({ error: String(error) }, { status: 500, headers: corsHeaders });
  }
});

async function fetchDailySummaries(user_id: string) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data, error } = await supabase
    .from("daily_summaries")
    .select("log_date, total_calories, total_protein_g, total_carbs_g, total_fat_g, entry_count")
    .eq("user_id", user_id)
    .gte("log_date", sevenDaysAgo.toISOString().split("T")[0])
    .order("log_date", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

async function fetchUserProfile(user_id: string) {
  const { data, error } = await supabase
    .from("user_profiles")
    .select("daily_calories_target, daily_protein_g, daily_carbs_g, daily_fat_g, goal, target_weight_kg, current_weight_kg")
    .eq("user_id", user_id)
    .single();

  if (error) return null;
  return data;
}

async function fetchRecentWeights(user_id: string) {
  const { data, error } = await supabase
    .from("weight_logs")
    .select("log_date, weight_kg")
    .eq("user_id", user_id)
    .order("log_date", { ascending: false })
    .limit(7);

  if (error) return [];
  return data ?? [];
}

async function generateInsights(
  summaries: Array<{ log_date: string; total_calories: number; total_protein_g: number; total_carbs_g: number; total_fat_g: number; entry_count: number }>,
  profile: { daily_calories_target: number; daily_protein_g: number; daily_carbs_g: number; daily_fat_g: number; goal: string; target_weight_kg: number; current_weight_kg: number },
  weights: Array<{ log_date: string; weight_kg: number }>
): Promise<string[]> {
  const avgCalories = Math.round(summaries.reduce((s, d) => s + d.total_calories, 0) / summaries.length);
  const avgProtein  = Math.round(summaries.reduce((s, d) => s + d.total_protein_g, 0) / summaries.length);
  const avgCarbs    = Math.round(summaries.reduce((s, d) => s + d.total_carbs_g, 0) / summaries.length);
  const avgFat      = Math.round(summaries.reduce((s, d) => s + d.total_fat_g, 0) / summaries.length);

  const bestDay = summaries.reduce((best, day) =>
    Math.abs(day.total_calories - profile.daily_calories_target) <
    Math.abs(best.total_calories - profile.daily_calories_target) ? day : best
  );

  const weightTrend = weights.length >= 2
    ? (weights[0].weight_kg - weights[weights.length - 1].weight_kg).toFixed(1)
    : null;

  const prompt = `You are a friendly, encouraging nutrition coach. Based on the data below, write exactly 3 to 4 short, plain-English insights for this user. Each insight must be a single sentence. Be specific with numbers. Return ONLY a JSON array of strings — no markdown, no extra text.

USER GOAL: ${profile.goal.replace("_", " ")}
TARGET WEIGHT: ${profile.target_weight_kg}kg | CURRENT WEIGHT: ${profile.current_weight_kg}kg

DAILY TARGETS:
- Calories: ${profile.daily_calories_target} kcal
- Protein: ${profile.daily_protein_g}g | Carbs: ${profile.daily_carbs_g}g | Fat: ${profile.daily_fat_g}g

LAST ${summaries.length} DAYS OF DATA:
${summaries.map(d =>
  `  ${d.log_date}: ${d.total_calories} kcal | protein ${d.total_protein_g}g | carbs ${d.total_carbs_g}g | fat ${d.total_fat_g}g (${d.entry_count} entries)`
).join("\n")}

7-DAY AVERAGES:
- Calories: ${avgCalories} kcal (target ${profile.daily_calories_target})
- Protein: ${avgProtein}g (target ${profile.daily_protein_g}g)
- Carbs: ${avgCarbs}g (target ${profile.daily_carbs_g}g)
- Fat: ${avgFat}g (target ${profile.daily_fat_g}g)

BEST DAY (closest to calorie target): ${bestDay.log_date} at ${bestDay.total_calories} kcal
${weightTrend !== null ? `WEIGHT CHANGE THIS WEEK: ${Number(weightTrend) > 0 ? "+" : ""}${weightTrend}kg` : "NO WEIGHT LOGS THIS WEEK"}

Write 3–4 insights covering: macro adherence, consistency, weight trend (if available), and one actionable food tip. Return as JSON array: ["insight 1", "insight 2", ...]`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: "You are a nutrition coach. Return ONLY valid JSON — a string array of insights. No markdown.",
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text.trim() : "[]";
  return JSON.parse(text);
}
