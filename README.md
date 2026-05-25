# AI Nutrition Tracker

An AI-native replacement for MyFitnessPal. Point your camera at food — Claude Vision identifies it and calculates the macros automatically. Set a target weight and track your daily protein, carbs, and fat intake.

## What makes this different from MyFitnessPal

| Feature | MyFitnessPal | This app |
|---|---|---|
| Food logging | Manual search through database | Photo → AI identifies food instantly |
| Ethnic food support | Inconsistent user submissions | Claude Vision trained on Indian, Middle Eastern, Australian cuisines |
| Macro targets | Generic formulas | Claude calculates personalised TDEE |
| UX | Clunky, ad-heavy | Clean mobile-first UI |

## Architecture

```
Lovable (React PWA)
    ↓
Supabase (PostgreSQL + Storage)
    ↓
Supabase Edge Functions (Deno/TypeScript)
    ↓
Claude claude-sonnet-4-6 Vision API + USDA FoodData Central + Open Food Facts
```

## AI Agents

### `analyze-food`
Takes a food photo URL, sends it to Claude Vision for identification and portion estimation, then cross-references USDA and Open Food Facts for macro accuracy. Returns structured JSON with per-item macros. Handles Indian, Middle Eastern, and Australian foods specifically.

### `calculate-targets`
Takes user profile (age, weight, height, activity level, goal) and calculates personalised daily calorie and macro targets using the Mifflin-St Jeor equation. Saves result to Supabase.

## Setup

### 1. Supabase
1. Create a new project at [supabase.com](https://supabase.com)
2. Run `supabase/migrations/20260525_init.sql` in the SQL editor
3. Create a `food-photos` storage bucket (set to public)
4. Deploy Edge Functions:
   ```
   supabase functions deploy analyze-food
   supabase functions deploy calculate-targets
   ```
5. Set secrets:
   ```
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase secrets set USDA_API_KEY=your-key
   ```

### 2. USDA API Key
Register free at [fdc.nal.usda.gov/api-key-signup.html](https://fdc.nal.usda.gov/api-key-signup.html)

### 3. Frontend (Lovable)
Create a new project at [lovable.dev](https://lovable.dev), connect to this GitHub repo and your Supabase project, then use the prompts in the build plan.

## What I learned building this

- **Multimodal AI**: Sending images to Claude requires base64 encoding. Portion estimation from photos is approximate but good enough for trend tracking.
- **Ethnic food coverage**: USDA has poor coverage of Indian/Middle Eastern dishes. Claude's own estimates are surprisingly accurate for common dishes (biryani, dal, hummus). Open Food Facts fills the gap for packaged ethnic foods.
- **Structured output**: Getting Claude to return consistent JSON requires explicit schema in the prompt and handling parse errors gracefully.
- **Mobile camera on web**: `<input type="file" capture="environment">` triggers the rear camera on iOS/Android without a native app.

## Stack

- **Frontend**: Lovable (React + Vite + TypeScript + Tailwind + shadcn)
- **Database**: Supabase (PostgreSQL + Storage)
- **AI**: Claude claude-sonnet-4-6 (multimodal vision)
- **Food Data**: USDA FoodData Central + Open Food Facts (both free)
- **Auth**: Supabase Auth
