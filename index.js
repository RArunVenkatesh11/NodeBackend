const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const app = express();
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.options("*", cors());
app.use(express.json());

// GET /health - Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "InnooRyze MMA Backend",
    timestamp: new Date().toISOString()
  });
});

// POST /api/assessments/start - Create a new assessment
app.post("/api/assessments/start", async (req, res) => {
  try {
    const { businessType, userInfo, selectedCategories } = req.body;

    // Validation
    if (!businessType || (businessType !== "B2B" && businessType !== "B2C")) {
      return res.status(400).json({ error: "businessType is required and must be 'B2B' or 'B2C'." });
    }

    if (!userInfo) {
      return res.status(400).json({ error: "userInfo is required." });
    }

    const { firstName, email, businessName, country, industry } = userInfo;

    if (!firstName || !firstName.trim()) {
      return res.status(400).json({ error: "userInfo.firstName is required." });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({ error: "userInfo.email is required." });
    }

    if (!businessName || !businessName.trim()) {
      return res.status(400).json({ error: "userInfo.businessName is required." });
    }

    // Look up existing user by email
    const { data: existingUsers, error: userLookupError } = await supabase
      .from("users")
      .select("*")
      .eq("email", email.trim())
      .limit(1);

    if (userLookupError) {
      console.error("Error looking up user:", userLookupError);
      return res.status(500).json({ error: "Failed to start assessment." });
    }

    let user;

    if (existingUsers && existingUsers.length > 0) {
      user = existingUsers[0];
    } else {
      // Insert new user
      const { data: newUser, error: insertUserError } = await supabase
        .from("users")
        .insert({
          email: email.trim(),
          first_name: firstName.trim(),
          last_name: "",
          phone: null,
          business_name: businessName.trim(),
          country: country || null,
          industry: industry || null,
          company_size: null
        })
        .select()
        .single();

      if (insertUserError) {
        console.error("Error inserting user:", insertUserError);
        return res.status(500).json({ error: "Failed to start assessment." });
      }

      user = newUser;
    }

    // Insert assessment
    const { data: assessment, error: insertAssessmentError } = await supabase
      .from("assessments")
      .insert({
        user_id: user.id,
        business_type: businessType,
        selected_categories: selectedCategories || [],
        status: "started"
      })
      .select()
      .single();

    if (insertAssessmentError) {
      console.error("Error inserting assessment:", insertAssessmentError);
      return res.status(500).json({ error: "Failed to start assessment." });
    }

    res.json({ assessmentId: assessment.id });

  } catch (error) {
    console.error("Error in /api/assessments/start:", error);
    res.status(500).json({ error: "Failed to start assessment." });
  }
});

// POST /api/assessments/:id/submit - Submit answers and get scoring
app.post("/api/assessments/:id/submit", async (req, res) => {
  try {
    const { id } = req.params;
    const { businessType, selectedCategories, answers } = req.body;

    if (!id) {
      return res.status(400).json({ error: "Assessment ID is required." });
    }

    if (!answers || typeof answers !== "object" || Object.keys(answers).length === 0) {
      return res.status(400).json({ error: "answers must be a non-empty object." });
    }

    // Verify assessment exists before processing
    const { data: existingAssessment, error: lookupError } = await supabase
      .from("assessments")
      .select("id, status")
      .eq("id", id)
      .single();

    if (lookupError || !existingAssessment) {
      return res.status(404).json({ error: "Assessment not found." });
    }

    // Build system prompt for OpenAI
    const systemPrompt = `You are a marketing consultant specializing in marketing maturity assessments. Analyze the provided answers and generate a comprehensive marketing maturity assessment.

You must return a valid JSON object with this exact structure:
{
  "scores": {
    "overall": <number between 1-5>,
    "data": <number between 1-5>,
    "channels": <number between 1-5>,
    "technology": <number between 1-5>,
    "content": <number between 1-5>,
    "strategy": <number between 1-5>
  },
  "analysis": "<string: 2-3 paragraph narrative explanation of their current marketing maturity level, strengths, and areas for improvement>",
  "options": {
    "crawl": {
      "summary": "<string: brief description of foundational improvements>",
      "actions": ["<action 1>", "<action 2>", "<action 3>"]
    },
    "walk": {
      "summary": "<string: brief description of intermediate improvements>",
      "actions": ["<action 1>", "<action 2>", "<action 3>"]
    },
    "run": {
      "summary": "<string: brief description of advanced improvements>",
      "actions": ["<action 1>", "<action 2>", "<action 3>"]
    }
  },
  "growthSimulation": {
    "crawl": {
      "data": <projected score>,
      "channels": <projected score>,
      "technology": <projected score>,
      "content": <projected score>,
      "strategy": <projected score>
    },
    "walk": {
      "data": <projected score>,
      "channels": <projected score>,
      "technology": <projected score>,
      "content": <projected score>,
      "strategy": <projected score>
    },
    "run": {
      "data": <projected score>,
      "channels": <projected score>,
      "technology": <projected score>,
      "content": <projected score>,
      "strategy": <projected score>
    }
  }
}

Only include categories that are in the selectedCategories array. The scores should reflect the answers provided, where higher scores indicate more mature marketing practices. Growth simulation should show realistic projected improvements for each growth path (crawl = small improvements, walk = moderate improvements, run = aggressive improvements).`;

    const userContent = JSON.stringify({
      businessType,
      selectedCategories,
      answers
    });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ]
    });

    let result;
    try {
      result = JSON.parse(response.choices[0].message.content);
    } catch (parseError) {
      console.error("Error parsing OpenAI response:", parseError);
      return res.status(500).json({ error: "Failed to generate assessment results." });
    }

    const { scores, analysis, options, growthSimulation } = result;

    // Update assessment in database
    const { error: updateError } = await supabase
      .from("assessments")
      .update({
        raw_answers: answers,
        scores: scores,
        analysis: analysis,
        options: options,
        growth_simulation: growthSimulation,
        status: "completed",
        completed_at: new Date().toISOString()
      })
      .eq("id", id);

    if (updateError) {
      console.error("Error updating assessment:", updateError);
      return res.status(500).json({ error: "Failed to generate assessment results." });
    }

    res.json({
      assessmentId: id,
      scores,
      analysis,
      options,
      growthSimulation
    });

  } catch (error) {
    console.error("Error in /api/assessments/:id/submit:", error);
    res.status(500).json({ error: "Failed to generate assessment results." });
  }
});

// GET /api/assessments/:id - Get assessment by ID
app.get("/api/assessments/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data: assessment, error } = await supabase
      .from("assessments")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !assessment) {
      return res.status(404).json({ error: "Assessment not found." });
    }

    res.json(assessment);

  } catch (error) {
    console.error("Error in /api/assessments/:id:", error);
    res.status(500).json({ error: "Failed to retrieve assessment." });
  }
});

// POST /api/assessments/:id/pdf - PDF export stub
app.post("/api/assessments/:id/pdf", (req, res) => {
  res.status(501).json({ message: "PDF export not implemented yet." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 InnooRyze MMA backend listening on port " + PORT);
  console.log("");
  console.log("InnooRyze MMA Backend Ready");
  console.log("");
  console.log("Endpoints:");
  console.log("GET    /health");
  console.log("POST   /api/assessments/start");
  console.log("POST   /api/assessments/:id/submit");
  console.log("GET    /api/assessments/:id");
  console.log("POST   /api/assessments/:id/pdf");
});
