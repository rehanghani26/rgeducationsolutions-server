/**
 * @file validate.tool.js
 * @description School ERP Domain & Relevance Validation Guardrail for RGES AI.
 *
 * Enforces strict domain boundaries:
 *   1. Verifies whether an incoming inquiry pertains to school ERP operations.
 *   2. Rejects out-of-domain external questions (e.g., celebrities like Salman Khan,
 *      general trivia, coding tutorials, politics, sports, recipes, external news).
 *   3. Directs users politely back to permitted school management capabilities.
 */

// ─── 1. ALL RECOGNIZED SCHOOL & ERP DOMAINS ──────────────────────────────────
export const SYSTEM_MODULE_DOMAINS = [
  {
    module: "Students & Admissions",
    keywords: [
      "student", "students", "admission", "admissions", "enroll", "enrollment",
      "roll", "roll number", "id card", "idcard", "student leave", "student fees",
      "marksheet", "report card", "transfer certificate", "bonafide", "promotion",
      "credentials", "disciplinary", "homework", "parent", "guardian", "sibling",
      "hostel", "dormitory", "medical profile", "blood group", "child",
    ],
  },
  {
    module: "Faculty & Staff",
    keywords: [
      "teacher", "teachers", "faculty", "staff", "hod", "principal", "director",
      "coordinator", "payroll", "salary", "salaries", "salary slip", "staff leave",
      "workload", "teacher attendance", "assigned class", "subject teacher",
    ],
  },
  {
    module: "Academics & Timetable",
    keywords: [
      "class", "classes", "section", "sections", "subject", "subjects",
      "syllabus", "curriculum", "textbook", "textbooks", "book", "chapters",
      "timetable", "period", "periods", "schedule", "bell schedule", "room",
      "classroom", "course", "lesson plan",
    ],
  },
  {
    module: "Attendance",
    keywords: [
      "attendance", "present", "absent", "leave", "leaves", "late", "streak",
      "attendance rate", "daily attendance", "monthly attendance", "half day",
    ],
  },
  {
    module: "Fees & Finance",
    keywords: [
      "fee", "fees", "dues", "defaulter", "defaulters", "payment", "receipt",
      "invoice", "challan", "ledger", "tuition", "budget", "allocation",
      "spending", "expense", "revenue", "financial", "concession", "discount",
    ],
  },
  {
    module: "Examinations & Results",
    keywords: [
      "exam", "exams", "examination", "test", "quiz", "marks", "grade",
      "grading", "gradebook", "topper", "toppers", "rank", "percentile",
      "passing percentage", "term", "midterm", "final exam", "result", "results",
    ],
  },
  {
    module: "Operations & Facilities",
    keywords: [
      "bus", "transport", "route", "routes", "vehicle", "driver", "pickup",
      "drop", "library", "borrow", "borrowed", "issued books", "return date",
      "fine", "fines", "inventory", "stock", "supplies", "vendor", "procurement",
    ],
  },
  {
    module: "Administration & Setup",
    keywords: [
      "setup", "wizard", "academic session", "session", "calendar", "profile",
      "school profile", "setting", "settings", "policy", "policies", "rule", "rules",
      "role", "roles", "permission", "permissions", "rbac", "access", "view scope",
      "notice", "circular", "announcement", "dashboard", "analytics", "kpi",
    ],
  },
];

// Flat list of all recognized school keywords
const ALL_SCHOOL_KEYWORDS = new Set(
  SYSTEM_MODULE_DOMAINS.flatMap((d) => d.keywords.map((k) => k.toLowerCase()))
);

// ─── 2. EXPLICIT NON-SCHOOL EXTERNAL TOPIC PATTERNS ──────────────────────────
const EXTERNAL_TOPIC_PATTERNS = [
  // Celebrities, actors, Bollywood, Hollywood, singers, entertainment
  /\b(salman khan|shah rukh khan|srk|aamir khan|amitabh bachchan|deepika|katrina|alia bhatt|ranbir kapoor|hrithik|akshay kumar|tom cruise|leonardo|brad pitt|taylor swift|bts|drake|ariana grande|bieber|celebrity|celebrities|actor|actress|bollywood|hollywood|movie|movies|cinema|box office|netflix show|web series|film|trailer)\b/i,

  // World politics, external governments, politicians, prime ministers, presidents
  /\b(narendra modi|rahul gandhi|bjp|congress|donald trump|joe biden|barack obama|putin|zelensky|prime minister of|president of (?!school)|election|elections|parliament|political party|democrat|republican|united nations|nato)\b/i,

  // General coding, external software development tutorials
  /\b(write (?:a )?(?:python|javascript|c\+\+|java|golang|rust|html|css|sql|php|ruby) (?:code|program|script|function)|how to code|binary search tree|quicksort|merge sort|leetcode|hackerrank|build a website using|install docker|git clone|kubernetes)\b/i,

  // Cooking, recipes, food preparation
  /\b(recipe|how to cook|how to make (?:biryani|pizza|burger|cake|pasta|tea|coffee|curry|dosa)|ingredients for (?:biryani|cake|pizza))\b/i,

  // Sports & external gaming (outside school sports periods)
  /\b(cricket world cup|ipl (?:match|score|auction)|fifa world cup|premier league|champions league|lionel messi|cristiano ronaldo|virat kohli|rohit sharma|ms dhoni|who won (?:the match|ipl|world cup)|gta 5|playstation|xbox|pubg|free fire|fortnite|minecraft)\b/i,

  // Cryptocurrency & stock trading
  /\b(bitcoin|ethereum|crypto|cryptocurrency|dogecoin|binance|stock market|share market|nifty|sensex|forex trading|invest in stocks)\b/i,

  // General world geography, history, and science homework trivia
  /\b(capital of (?!school)|largest (?:ocean|river|desert|mountain|continent)|distance to (?:moon|mars|sun)|who discovered|who invented (?!school)|theory of relativity|quantum mechanics|speed of light)\b/i,
];

// Conversational greetings and pleasantries that are always permitted
const PERMITTED_PLEASANTRIES = /^(hi|hello|hey|greetings|good morning|good afternoon|good evening|who are you|what can you do|help|help me|menu|commands|start|thanks|thank you|ok|okay|bye|goodbye|what is rges)\b/i;

// ─── 3. CORE VALIDATION LOGIC ────────────────────────────────────────────────

/**
 * Validates whether a user prompt is related to school ERP modules or external trivia.
 *
 * @param {string} prompt - Raw user query
 * @returns {{
 *   isValid: boolean,
 *   reason?: string,
 *   matchedModule?: string,
 *   response?: string
 * }}
 */
export function validateSchoolQuery(prompt) {
  if (!prompt || typeof prompt !== "string") {
    return { isValid: false, reason: "empty_query", response: "Please provide a valid query." };
  }

  const clean = prompt.trim();
  const lower = clean.toLowerCase();

  // 1. Always allow standard pleasantries, greetings, and system capability questions
  if (PERMITTED_PLEASANTRIES.test(lower)) {
    return { isValid: true, matchedModule: "Conversational" };
  }

  // 2. Check for explicit off-topic external categories (celebrities, movies, politics, recipes, etc.)
  for (const pattern of EXTERNAL_TOPIC_PATTERNS) {
    if (pattern.test(lower)) {
      return {
        isValid: false,
        reason: "external_topic",
        response: buildOffTopicResponse(clean),
      };
    }
  }

  // 3. Check if query matches recognized school & ERP module domains
  for (const domain of SYSTEM_MODULE_DOMAINS) {
    for (const kw of domain.keywords) {
      // Word boundary match for the keyword
      const kwRegex = new RegExp(`\\b${escapeRegExp(kw)}\\b`, "i");
      if (kwRegex.test(lower)) {
        return {
          isValid: true,
          matchedModule: domain.module,
        };
      }
    }
  }

  // 4. Check for typical ERP operational action phrases (e.g., "show me all", "list", "get report", "create", "update")
  const erpActionPhrases = [
    /\b(show|list|get|find|search|view|display|check|fetch|generate|print|create|add|enroll|register|admit|promote|delete|remove|update|edit)\b/i,
    /\b(how many|who is|details of|summary of|report of|status of|overview of)\b/i,
    /\b(today|yesterday|tomorrow|this week|this month|academic year|session)\b/i,
    /\b(total|count|pending|paid|unpaid|due|absent|present|active|inactive)\b/i,
  ];

  const hasActionPhrase = erpActionPhrases.some((re) => re.test(lower));

  // If query contains an action phrase and does NOT contain external forbidden entities, allow it through
  if (hasActionPhrase) {
    return {
      isValid: true,
      matchedModule: "ERP Operations",
    };
  }

  // 5. Short natural language queries (1-3 words) that might refer to a student or teacher name
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= 4) {
    // Treat short queries as potential student / staff / class name lookups
    return {
      isValid: true,
      matchedModule: "Search / Entity Lookup",
    };
  }

  // 6. Generic or ambiguous queries — allow model to interpret with school context guardrail
  return {
    isValid: true,
    matchedModule: "General School Query",
  };
}

/**
 * Builds a friendly, professional refusal message for external queries.
 *
 * @param {string} userQuery
 * @returns {string}
 */
export function buildOffTopicResponse(userQuery = "") {
  return `I am **RGES AI**, your dedicated School Management ERP Assistant.

I cannot provide details about external topics, celebrities, entertainment, or general web trivia. I can only assist with operations and records related to your **school and ERP system**.

Here are some things you can ask me about:
- 👨‍🎓 **Students & Admissions**: *"Show all students in Class 10"*, *"Student ID card preview"*, *"Pending admissions"*
- 👨‍🏫 **Teachers & Staff**: *"List all faculty members"*, *"Staff payroll summary"*
- 📊 **Attendance**: *"Today's attendance rate"*, *"Show absent students today"*
- 💰 **Fees & Finance**: *"Show fee collection summary"*, *"List fee defaulters"*, *"Current session budget"*
- 📝 **Exams & Grading**: *"Upcoming exam schedule"*, *"Class 10 toppers and marksheet status"*
- 🏫 **Academics & Timetables**: *"Show class timetable"*, *"Class 9 syllabus and prescribed books"*
- 🚌 **Transport & Library**: *"Show bus routes and stops"*, *"Overdue library books"*
- ⚙️ **School Setup**: *"School setup wizard progress"*, *"Role permissions"*

Please ask a question related to your school!`;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── 4. AI TOOL DEFINITION & EXECUTOR ─────────────────────────────────────────

export const validationToolDefinitions = [
  {
    name: "validateQueryRelevance",
    description:
      "Checks whether an inquiry or topic pertains to school ERP management (students, faculty, attendance, fees, exams, timetable, setup) or external non-school topics.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The user query or topic to evaluate.",
        },
      },
      required: ["query"],
    },
  },
];

export const validationToolExecutors = {
  async validateQueryRelevance({ query }) {
    const result = validateSchoolQuery(query);
    return {
      success: true,
      query,
      isSchoolRelated: result.isValid,
      matchedModule: result.matchedModule || "None",
      reason: result.reason || "valid_school_topic",
      message: result.isValid
        ? `Query is valid and pertains to the "${result.matchedModule}" module.`
        : "Query is an external/non-school topic and should be politely redirected.",
    };
  },
};
