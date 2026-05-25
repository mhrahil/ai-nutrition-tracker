import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js";

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

interface OnboardingInput {
  user_id: string;
  name: string;
  age: number;
  gender: string;
  height_cm: number;
  current_weight_kg: number;
  target_weight_kg: number;
  activity_level: string;
  goal: string;
}

interface MacroTargets {
  daily_calories_target: number;
  daily_protein_g: number;
  daily_carbs_g: number;
  daily_fat_g: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const input: OnboardingInput = await req.json();

    const targets = await calculateTargets(input);

    await supabase.from("user_profiles").upsert({
      user_id: input.user_id,
      name: input.name,
      age: input.age,
      gender: input.gender,
      height_cm: input.height_cm,
      current_weight_kg: input.current_weight_kg,
      target_weight_kg: input.target_weight_kg,
      activity_level: input.activity_level,
      goal: input.goal,
      ...targets,
    });

    return Response.json(targets, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500, headers: corsHeaders });
  }
});

async function calculateTargets(input: OnboardingInput): Promise<MacroTargets> {
  const activityMultipliers: Record<string, number> = {
    sedentary: 1.2,
    lightly_active: 1.375,
    moderately_active: 1.55,
    very_active: 1.725,
    extra_active: 1.9,
  };

  const bmr =
    input.gender === "male"
      ? 10 * input.current_weight_kg + 6.25 * input.height_cm - 5 * input.age + 5
      : 10 * input.current_weight_kg + 6.25 * input.height_cm - 5 * input.age - 161;

  const multiplier = activityMultipliers[input.activity_level] ?? 1.55;
  const tdee = Math.round(bmr * multiplier);

  const caloryAdjustment =
    input.goal === "lose_weight" ? -500 : input.goal === "gain_muscle" ? 300 : 0;

  const daily_calories_target = tdee + caloryAdjustment;

  // Macro splits by goal
  const splits: Record<string, [number, number, number]> = {
    lose_weight: [0.40, 0.35, 0.25],  // protein, carbs, fat
    gain_muscle: [0.35, 0.45, 0.20],
    maintain:    [0.30, 0.40, 0.30],
  };

  const [proteinRatio, carbsRatio, fatRatio] = splits[input.goal] ?? splits.maintain;

  return {
    daily_calories_target,
    daily_protein_g: Math.round((daily_calories_target * proteinRatio) / 4),
    daily_carbs_g:   Math.round((daily_calories_target * carbsRatio)   / 4),
    daily_fat_g:     Math.round((daily_calories_target * fatRatio)     / 9),
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
