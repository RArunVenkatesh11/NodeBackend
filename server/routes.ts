import type { Express } from "express";
import { type Server } from "http";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import cors from "cors";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SUPABASE_URL) {
  console.warn("WARNING: SUPABASE_URL is not set");
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("WARNING: SUPABASE_SERVICE_ROLE_KEY is not set");
}
if (!OPENAI_API_KEY) {
  console.warn("WARNING: OPENAI_API_KEY is not set");
}

const supabase = createClient(
  SUPABASE_URL || "",
  SUPABASE_SERVICE_ROLE_KEY || "",
);

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY || "",
});

type CategoryScore = { category: string; score: number };

type BenchmarkItem = {
  label: string | null;
  score: number | null;
};

type Benchmarks = Record<string, BenchmarkItem>;

/**
 * Normalise whatever structure comes back from OpenAI / DB
 * into [{ category, score }] so the frontend can always rely
 * on the same shape.
 */
function normalizeScores(raw: any): CategoryScore[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item: any) => {
        const category =
          item.category ?? item.name ?? item.key ?? item.id ?? "overall";

        const score =
          typeof item.score === "number"
            ? item.score
            : typeof item.value === "number"
            ? item.value
            : Number(item.score ?? item.value ?? 0);

        return {
          category: String(category),
          score: Number.isFinite(score) ? Number(score) : 0,
        };
      })
      .filter((item: CategoryScore) => !Number.isNaN(item.score));
  }

  if (raw && typeof raw === "object") {
    return Object.entries(raw).map(([category, value]) => {
      let scoreValue: any = 0;

      if (value && typeof value === "object" && "score" in value) {
        scoreValue = (value as any).score;
      } else {
        scoreValue = value;
      }

      const score = Number(scoreValue);

      return {
        category,
        score: Number.isFinite(score) ? score : 0,
      };
    });
  }

  return [];
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // CORS
  app.use(
    cors({
      origin: "*",
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );
  app.options("*", cors());

  // Health check
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: "InnooRyze MMA Backend",
      timestamp: new Date().toISOString(),
    });
  });
  // Start assessment: create / reuse user, create assessment row
  app.post("/api/assessments/start", async (req, res) => {
    try {
      const { businessType, userInfo, selectedCategories } = req.body ?? {};

      if (!businessType || (businessType !== "B2B" && businessType !== "B2C")) {
        return res
          .status(400)
          .json({ error: "businessType must be 'B2B' or 'B2C'" });
      }

      if (!userInfo || typeof userInfo !== "object") {
        return res.status(400).json({ error: "userInfo is required" });
      }

      const { firstName, email, businessName, country, industry } = userInfo;

      if (!firstName || !String(firstName).trim()) {
        return res
          .status(400)
          .json({ error: "userInfo.firstName is required." });
      }

      if (!email || !String(email).trim()) {
        return res.status(400).json({ error: "userInfo.email is required." });
      }

      if (!businessName || !String(businessName).trim()) {
        return res
          .status(400)
          .json({ error: "userInfo.businessName is required." });
      }

      // Look up existing user by email
      const { data: existingUsers, error: userLookupError } = await supabase
        .from("users")
        .select("*")
        .eq("email", String(email).trim())
        .limit(1);

      if (userLookupError) {
        console.error("Error looking up user:", userLookupError);
        return res.status(500).json({ error: "Failed to start assessment." });
      }

      let user: any;

      if (existingUsers && existingUsers.length > 0) {
        user = existingUsers[0];
      } else {
        // Insert new user
        const { data: newUser, error: insertUserError } = await supabase
          .from("users")
          .insert({
            email: String(email).trim(),
            first_name: String(firstName).trim(),
            last_name: "",
            phone: null,
            business_name: String(businessName).trim(),
            country: country || null,
            industry: industry || null,
            company_size: null,
          })
          .select()
          .single();

        if (insertUserError) {
          console.error("Error inserting user:", insertUserError);
          return res.status(500).json({ error: "Failed to start assessment." });
        }

        user = newUser;
      }

      const categoryList: string[] = Array.isArray(selectedCategories)
        ? selectedCategories.map((c: any) => String(c))
        : [];

      // Insert assessment
      const { data: assessment, error: insertAssessmentError } = await supabase
        .from("assessments")
        .insert({
          user_id: user.id,
          business_type: businessType,
          selected_categories: categoryList,
          status: "started",
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (insertAssessmentError || !assessment) {
        console.error("Error inserting assessment:", insertAssessmentError);
        return res.status(500).json({ error: "Failed to start assessment." });
      }

      res.json({ assessmentId: assessment.id });
    } catch (error) {
      console.error("Error in /api/assessments/start:", error);
      res.status(500).json({ error: "Failed to start assessment." });
    }
  });
    // Submit answers & get AI scoring + benchmarks + growth simulation
    app.post("/api/assessments/:id/submit", async (req, res) => {
      try {
        const { id } = req.params;
        const { businessType, selectedCategories, answers } = req.body ?? {};

        if (!id) {
          return res.status(400).json({ error: "Assessment ID is required." });
        }

        if (!answers || typeof answers !== "object") {
          return res
            .status(400)
            .json({ error: "answers object is required for scoring." });
        }

        const categories: string[] = Array.isArray(selectedCategories)
          ? selectedCategories.map((c: any) => String(c))
          : ["data", "channels", "technology", "content", "strategy"];

        const systemPrompt = `
  You are a senior B2B/B2C marketing consultant helping small and mid-sized businesses understand their marketing maturity.

  Your job:

  1. Read the raw answers from the assessment.
  2. Score the company's current marketing maturity for each selected category on a 1–5 scale.
  3. Compare those scores to realistic industry benchmarks for a company of similar size and type (SME, ${String(
          businessType || "B2B/B2C",
        )}).
  4. Explain in clear, jargon-free language:
     - What they are doing well.
     - Where they are behind the benchmark.
     - What they should focus on next at Crawl, Walk and Run stages.

  Return ONLY a valid JSON object in this exact shape:

  {
    "scores": {
      "overall": <number 1-5>,
      "<category>": <number 1-5 per selected category>
    },
    "analysis": {
      "overallSummary": "<2–3 sentence plain-English summary of their maturity>",
      "perCategory": [
        {
          "category": "<category name>",
          "headline": "<short one-line insight>",
          "doingWell": [
            "<1–2 sentence bullet that calls out a specific strength with an example or behaviour>",
            "<1–2 sentence bullet that calls out another concrete strength>"
          ],
          "behind": [
            "<1–2 sentence bullet that calls out a gap AGAINST THE BENCHMARK and why it matters>",
            "<1–2 sentence bullet that explains impact of the gap on revenue, pipeline, CX, etc.>"
          ]
        }
      ]
    },
    "benchmarks": {
      "<category>": {
        "label": "<short label like 'Average B2B SME content maturity'>",
        "score": <number 1-5 representing typical benchmark>
      }
    },
    "options": {
      "crawl": {
        "label": "Crawl (Foundations)",
        "summary": "<1–2 sentence summary of foundational focus in business terms>",
        "actions": [
          "<concrete foundational action with clear outcome, e.g. 'Consolidate all customer data into a single list and standardise key fields (email, consent, country)' >",
          "<concrete foundational action linked to a category gap>",
          "<concrete foundational action that can be done in 30–90 days>"
        ]
      },
      "walk": {
        "label": "Walk (Accelerate)",
        "summary": "<1–2 sentence summary of intermediate focus and expected 6–12 month impact>",
        "actions": [
          "<specific optimisation / automation step and what metric it improves>",
          "<specific use of segmentation / journeys / content to close the benchmark gap>",
          "<specific action that builds on Crawl and prepares for Run>"
        ]
      },
      "run": {
        "label": "Run (Scale & Optimize)",
        "summary": "<1–2 sentence summary of advanced focus and expected scale impact>",
        "actions": [
          "<advanced, but still practical, initiative (e.g. predictive scoring, multi-channel orchestration) and the key KPI it affects>",
          "<another advanced initiative that uses data & tech more deeply>",
          "<optimisation / experimentation action to continuously tune performance>"
        ]
      }
    },
    "growthSimulation": {
      "crawl": {
        "<category>": <projected score after implementing crawl actions>
      },
      "walk": {
        "<category>": <projected score after implementing walk actions>
      },
      "run": {
        "<category>": <projected score after implementing run actions>
      }
    }
  }

  Rules:
  - Only include categories that are in this list: ${JSON.stringify(categories)}.
  - Always include "overall" in scores and growthSimulation.
  - Every number must be between 1 and 5.
  - Bullets must be specific and actionable, not generic. Refer to behaviours, processes, tooling or outcomes (e.g. leads, revenue, retention).
  - Keep each bullet to max 1–2 sentences (no long paragraphs).
  - Keep all language simple enough for a non-technical marketing leader to understand.
  `;

        const userContent = JSON.stringify(
          {
            businessType,
            selectedCategories: categories,
            answers,
          },
          null,
          2,
        );

        // Ask OpenAI for structured JSON output
        const response = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
        });

        let parsed: any = {};
        try {
          parsed = JSON.parse(response.choices[0].message?.content || "{}");
        } catch (parseError) {
          console.error("Error parsing OpenAI response:", parseError);
          return res
            .status(500)
            .json({ error: "Failed to parse AI assessment results." });
        }

        // Extract & normalise
        const rawScores = parsed.scores ?? {};
        const normalizedScores = normalizeScores(rawScores);

        const analysis = parsed.analysis ?? {};
        const options = parsed.options ?? {};
        const rawBenchmarks = parsed.benchmarks ?? {};
        const benchmarks: Benchmarks = rawBenchmarks;

        // ---- BUILD GROWTH SIMULATION FOR CRAWL / WALK / RUN ----

        type GrowthSimulationCategory = {
          category: string;
          currentScore: number;
          afterScore: number;
          benchmarkScore: number;
        };

        const categoryScores: CategoryScore[] = normalizedScores.filter(
          (s: CategoryScore) => s.category !== "overall",
        );

        const getBenchmarkForCategory = (category: string): number => {
          const b: any = (benchmarks as any)?.[category];

          if (!b) {
            return 3; // default mid-level benchmark if missing
          }

          if (typeof b === "number") {
            return b;
          }

          if (typeof b.score === "number") {
            return b.score;
          }

          return 3;
        };

        const buildPlanSimulation = (
          multiplier: number,
        ): GrowthSimulationCategory[] => {
          return categoryScores.map(({ category, score }) => {
            const benchmarkScore = getBenchmarkForCategory(category);
            const gap = benchmarkScore - score;
            const rawAfter = score + gap * multiplier;

            const currentScore = Number(score.toFixed(2));
            const afterScore = Number(
              Math.max(0, Math.min(5, rawAfter)).toFixed(2),
            );
            const normalizedBenchmark = Number(
              Math.max(0, Math.min(5, benchmarkScore)).toFixed(2),
            );

            return {
              category,
              currentScore,
              afterScore,
              benchmarkScore: normalizedBenchmark,
            };
          });
        };

        const growthSimulation = {
          crawl: buildPlanSimulation(0.3),
          walk: buildPlanSimulation(0.6),
          run: buildPlanSimulation(0.9),
        };

        // Save into Supabase
        const { error: updateError } = await supabase
          .from("assessments")
          .update({
            raw_answers: answers,
            scores: normalizedScores,
            analysis,
            options,
            benchmarks,
            growth_simulation: growthSimulation,
            status: "completed",
            completed_at: new Date().toISOString(),
          })
          .eq("id", id);

        if (updateError) {
          console.error("Error updating assessment:", updateError);
          return res
            .status(500)
            .json({ error: "Failed to store assessment results." });
        }

        // Return payload for frontend (Step 5 + Step 6)
        res.json({
          assessmentId: id,
          scores: normalizedScores,
          analysis,
          options,
          benchmarks,
          growthSimulation,
        });
      } catch (error) {
        console.error("Error in /api/assessments/:id/submit:", error);
        res
          .status(500)
          .json({ error: "Failed to generate assessment results." });
      }
    });
    // Fetch completed assessment (for reload/share)
    app.get("/api/assessments/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const { data: assessment, error } = await supabase
          .from("assessments")
          .select("*")
          .eq("id", id)
          .single();

        if (error || !assessment) {
          console.error("Error fetching assessment:", error);
          return res.status(404).json({ error: "Assessment not found." });
        }

        const scores = normalizeScores(assessment.scores);

        res.json({
          assessmentId: assessment.id,
          scores,
          analysis: assessment.analysis,
          options: assessment.options,
          growthSimulation: assessment.growth_simulation,
          benchmarks: assessment.benchmarks ?? null,
          status: assessment.status,
        });
      } catch (error) {
        console.error("Error in GET /api/assessments/:id:", error);
        res.status(500).json({ error: "Failed to fetch assessment." });
      }
    });

    // PDF export stub (front-end already calls this, we'll wire real PDF later)
    app.post("/api/assessments/:id/pdf", async (_req, res) => {
      res
        .status(501)
        .json({ error: "PDF export is not implemented yet. Coming soon!" });
    });

    console.log("");
    console.log("InnooRyze MMA Backend Ready");
    console.log("Endpoints:");
    console.log("GET    /health");
    console.log("POST   /api/assessments/start");
    console.log("POST   /api/assessments/:id/submit");
    console.log("GET    /api/assessments/:id");
    console.log("POST   /api/assessments/:id/pdf");

    return httpServer;
  }
