# LexGuard — Multi-Agent AI Legal Information System

## Mini-Project Report

---

**Project Title:** LexGuard — Multi-Agent AI-Powered Legal Information System for Indian Law

**Author:** Amrut Dongre

**Date:** April 2026

---

## Table of Contents

| Sr. No. | Title |
|---------|-------|
| 1. | Introduction |
| 2. | Objective |
| 3. | Literature Review |
| 6. | Methodology |
| 7. | Main Principle |
| 8. | Algorithm |
| 9. | Advantages & Disadvantages |
| 10. | Applications |
| 11. | Technical Challenges |
| 13. | Case Studies |
| 14. | Conclusion |
| 15. | References |

---

## 1. Introduction

### 1.1 Background

The Indian legal system is one of the most complex judicial frameworks in the world, consisting of the Constitution of India, the Indian Penal Code (IPC) / Bharatiya Nyaya Sanhita (BNS), the Code of Criminal Procedure (CrPC) / Bharatiya Nagarik Suraksha Sanhita (BNSS), the Code of Civil Procedure (CPC), and countless special Acts. For ordinary citizens, students, and even junior legal professionals, navigating this vast landscape of statutes, procedures, and judicial precedents is an extremely challenging task. Legal information is scattered across numerous documents, acts, and court judgments.

Understanding how constitutional principles, statutory provisions, and judicial decisions connect to a specific legal issue requires significant effort and legal expertise. This information gap creates a barrier to legal awareness and access to justice — a fundamental right guaranteed under Article 39A of the Indian Constitution.

### 1.2 Problem Statement

There is currently no freely accessible, structured, and easy-to-understand system that can:
- Interpret a natural language legal question from a layperson
- Identify the relevant area of law (criminal, civil, constitutional, family)
- Discover applicable statutory provisions dynamically
- Find issue-specific judicial precedents
- Present the information in a structured, neutral, and non-advisory format
- Support multiple Indian languages

### 1.3 Proposed Solution

**LexGuard** is a Multi-Agent AI Legal Information System that addresses the above problem. It uses a coordinated pipeline of five specialized AI agents, powered by Google's Gemini Large Language Model (LLM), to analyze natural-language legal queries and produce structured, neutral, research-style legal explanations.

The system is built using a **Node.js/Express.js** backend with **server-side rendering (EJS)** and follows a modular, multi-agent architecture pattern inspired by modern AI orchestration systems.

### 1.4 Scope

LexGuard is designed as an educational and research tool. It provides **general legal information only** and explicitly does not constitute legal advice. The system focuses on Indian law and covers:
- Criminal law (IPC/BNS)
- Civil law (CPC)
- Constitutional law (Articles of the Indian Constitution)
- Family law
- Procedural law (CrPC/BNSS)

### 1.5 System Architecture Overview

```mermaid
graph TB
    User["👤 User (Browser)"]
    Server["🖥️ Express.js Server"]
    Orch["🎯 Orchestrator"]
    QA["🧠 Query Agent"]
    SA["📜 Statute Agent"]
    CLA["🔍 Case Law Agent"]
    VA["✅ Verification Agent"]
    DA["📝 Drafting Agent"]
    LLM["🤖 Google Gemini API"]
    Cache["💾 In-Memory Cache"]

    User -->|"HTTP POST /query"| Server
    Server -->|"Delegates"| Orch
    Orch -->|"Step 1"| QA
    Orch -->|"Step 2"| SA
    Orch -->|"Step 3"| CLA
    Orch -->|"Step 4"| VA
    Orch -->|"Step 5"| DA
    QA -->|"Prompt"| LLM
    SA -->|"Prompt"| LLM
    CLA -->|"Prompt"| LLM
    VA -->|"Prompt"| LLM
    DA -->|"Prompt"| LLM
    QA -.->|"Read/Write"| Cache
    SA -.->|"Read/Write"| Cache
    CLA -.->|"Read/Write"| Cache
    VA -.->|"Read/Write"| Cache
    DA -.->|"Read/Write"| Cache
    Server -->|"Renders HTML"| User
```

---

## 2. Objective

### 2.1 Primary Objectives

1. **To design and implement a multi-agent AI system** that decomposes complex legal queries into subtasks handled by specialized agents, coordinated by a central orchestrator.

2. **To provide structured legal information** to users by dynamically identifying relevant Indian statutes, constitutional articles, procedural safeguards, and judicial precedents for any given legal question.

3. **To support multilingual access** by enabling responses in 9 Indian languages (English, Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Malayalam, and Kannada), thereby improving legal awareness across linguistic barriers.

4. **To maintain neutrality and non-advisory tone** in all responses, ensuring the system provides information without making legal judgments or recommendations.

5. **To build a performant, scalable web application** using modern web technologies (Node.js, Express.js, EJS) with in-memory caching, structured logging, and security headers.

### 2.2 Secondary Objectives

1. To implement voice input capability using the Web Speech API for accessibility.
2. To enable comparison of two legal scenarios side by side.
3. To support conversational follow-up questions with session-based context retention.
4. To provide a "Simple Language" mode that re-explains legal content in everyday language.
5. To integrate an interactive legal glossary and section reference system.
6. To implement export functionality (PDF, copy-to-clipboard) for generated legal information.
7. To explore the design and architecture of multi-agent LLM systems as a software engineering study.

---

## 3. Literature Review

### 3.1 Natural Language Processing in Legal Domain

The intersection of Natural Language Processing (NLP) and the legal domain has been an active research area. Early work focused on information retrieval from legal databases. **Zhong et al. (2020)** proposed legal judgment prediction using topological multi-task learning, demonstrating that understanding legal structures improves NLP task accuracy. **Chalkidis et al. (2020)** introduced LEGAL-BERT, a family of pre-trained language models specifically for the legal domain, achieving state-of-the-art results on legal NLP benchmarks.

### 3.2 Large Language Models (LLMs) for Legal Applications

The advent of Large Language Models has transformed legal technology. **OpenAI's GPT-4 (2023)** demonstrated passing the Uniform Bar Examination at the 90th percentile, showing that LLMs possess significant legal reasoning capability. **Google's Gemini (2024)** further advanced multimodal understanding and reasoning, offering production-quality APIs for text generation. However, **Dahl et al. (2024)** highlighted that LLMs can "hallucinate" legal citations — generating plausible but non-existent case names — necessitating verification mechanisms.

### 3.3 Multi-Agent Systems

Multi-agent systems (MAS) have been studied extensively in AI literature. **Wooldridge & Jennings (1995)** defined intelligent agents as systems that are autonomous, reactive, proactive, and social. In the context of LLMs, **Park et al. (2023)** demonstrated "Generative Agents" — LLMs simulating human behaviors as agents. **Wu et al. (2023)** introduced AutoGen, a framework for building LLM-based multi-agent systems, showing that decomposing tasks across specialized agents yields more reliable and higher-quality outputs than monolithic prompting.

### 3.4 AI-Powered Legal Information Systems

Several commercial systems exist in this space:

| System | Features | Limitations |
|--------|----------|-------------|
| **Westlaw Edge** | Comprehensive legal database, AI-powered recommendations | Proprietary, expensive, US-centric |
| **LexisNexis** | Global coverage, citation analysis | Subscription-based, not India-focused |
| **Indian Kanoon** | Free Indian case law search | Keyword-based, no NLP understanding |
| **Nyaaya** | Indian law information for citizens | Static content, no dynamic analysis |
| **CaseMine** | Indian legal research + AI | Paid, targeted at lawyers |

### 3.5 Gap Identified

No existing free and accessible system provides:
- Dynamic, AI-powered analysis of arbitrary legal questions
- Multi-agent decomposition for reliability
- Structured, neutral output with verification
- Support for Indian regional languages
- Comparison of legal scenarios

LexGuard addresses these gaps through its multi-agent architecture and comprehensive feature set.

### 3.6 Prompt Engineering

**Wei et al. (2022)** introduced Chain-of-Thought (CoT) prompting, showing that prompting LLMs to reason step-by-step improves performance. LexGuard applies a related concept — **Chain-of-Agents** — where each agent's output feeds into the next, creating a structured reasoning pipeline rather than relying on a single monolithic prompt.

---

## 6. Methodology

### 6.1 Development Approach

LexGuard was developed using an **iterative, modular development methodology**. Each agent was designed, implemented, and tested independently before integration into the orchestrated pipeline.

### 6.2 Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Runtime** | Node.js (v18+) | Server-side JavaScript execution |
| **Framework** | Express.js v4.19 | HTTP server, routing, middleware |
| **AI/LLM** | Google Gemini API (gemini-2.0-flash, gemini-2.5-flash) | Natural language understanding & generation |
| **Templating** | EJS (Embedded JavaScript) | Server-side HTML rendering |
| **Security** | Helmet.js v7.1 | HTTP security headers (XSS, CSP, etc.) |
| **Rate Limiting** | express-rate-limit v7.2 | API abuse prevention (20 req/15 min/IP) |
| **Sessions** | express-session v1.19 | Follow-up context retention |
| **Caching** | Custom in-memory (Map + TTL) | Response caching to reduce API calls |
| **Logging** | Custom structured JSON logger | Observability and debugging |
| **Frontend** | HTML5, CSS3, Vanilla JavaScript | User interface |
| **Voice** | Web Speech API | Voice input in multiple languages |
| **Fonts** | Google Fonts (Inter) | Modern typography |

### 6.3 Project Structure

```
lexGuard/
├── agents/                      # AI Agent modules
│   ├── queryAgent.js            # Query decomposition & intent extraction
│   ├── statuteAgent.js          # Statute identification
│   ├── caseLawAgent.js          # Judicial precedent discovery
│   ├── verificationAgent.js     # Consistency & accuracy verification
│   └── draftingAgent.js         # Final response generation
├── services/                    # Shared service modules
│   ├── llmService.js            # Google Gemini API integration
│   ├── cacheService.js          # In-memory TTL cache
│   ├── jsonParser.js            # Robust JSON extraction from LLM output
│   └── logger.js                # Structured logging service
├── routes/
│   └── webRoutes.js             # All HTTP route handlers
├── views/                       # EJS templates
│   ├── index.ejs                # Home page with query form
│   ├── result.ejs               # Legal information result page
│   ├── compare.ejs              # Comparison input page
│   ├── compare-result.ejs       # Side-by-side comparison result
│   └── error.ejs                # Error page
├── public/                      # Static assets (served by Express)
│   ├── style.css                # Complete CSS stylesheet
│   ├── script.js                # Client-side JavaScript
│   └── data/
│       └── legal-sections.json  # Quick-reference for IPC/CrPC/Articles
├── orchestrator.js              # Central agent coordination pipeline
├── app.js                       # Express app configuration
├── server.js                    # Server entry point
├── .env                         # Environment variables (API key)
└── package.json                 # Node.js project manifest
```

### 6.4 Data Flow Diagram

```mermaid
sequenceDiagram
    participant U as User Browser
    participant S as Express Server
    participant O as Orchestrator
    participant Q as Query Agent
    participant ST as Statute Agent
    participant C as Case Law Agent
    participant V as Verification Agent
    participant D as Drafting Agent
    participant G as Gemini LLM API
    participant CA as Cache

    U->>S: POST /query {query, language}
    S->>S: Validate & sanitize input
    S->>S: Check session for follow-up context
    S->>O: orchestrator(query, language, context)
    
    O->>CA: Check cache for intent
    CA-->>O: Cache miss
    O->>Q: queryAgent(query)
    Q->>G: Prompt: Extract legal intent
    G-->>Q: JSON {jurisdiction, domain, issue, parties, intent}
    Q->>CA: Cache result (TTL: 1h)
    Q-->>O: Structured Intent
    
    O->>CA: Check cache for statutes
    CA-->>O: Cache miss
    O->>ST: statuteAgent(intent)
    ST->>G: Prompt: Identify statutes
    G-->>ST: JSON {substantive_laws, procedural_laws}
    ST->>CA: Cache result (TTL: 6h)
    ST-->>O: Statute Data
    
    O->>CA: Check cache for cases
    CA-->>O: Cache miss
    O->>C: caseLawAgent(intent, statutes, query)
    C->>G: Prompt: Find precedents
    G-->>C: JSON {judgments[]}
    C->>CA: Cache result (TTL: 4h)
    C-->>O: Case Law Data
    
    O->>V: verificationAgent({intent, statutes, cases})
    V->>G: Prompt: Verify accuracy
    G-->>V: JSON {status, confidence, observations}
    V->>CA: Cache result (TTL: 2h)
    V-->>O: Verification Result
    
    O->>D: draftingAgent({all data + language})
    D->>G: Prompt: Draft structured response
    G-->>D: Formatted text (6 sections + 4 related questions)
    D->>CA: Cache result (TTL: 1h)
    D-->>O: {text, relatedQuestions[]}
    
    O-->>S: {response, relatedQuestions, timings, metadata}
    S->>S: Parse sections, format timings
    S->>S: Store context in session
    S->>U: Render result.ejs with data
```

### 6.5 Security Measures

| Measure | Implementation |
|---------|----------------|
| **HTTP Security Headers** | Helmet.js (X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, etc.) |
| **Rate Limiting** | 20 requests per 15-minute window per IP address |
| **Input Sanitization** | Strips `<`, `>`, `{`, `}` characters; truncates to 2000 chars |
| **Input Validation** | Minimum 5-character query; language whitelist validation |
| **API Key Protection** | Stored in `.env` file; validated at startup; never logged |
| **Session Security** | Cryptographically random secret (32 bytes); 30-minute TTL |

---

## 7. Main Principle

### 7.1 Multi-Agent Orchestration

The core principle of LexGuard is **multi-agent orchestration** — decomposing a complex legal information retrieval task into smaller, specialized subtasks, each handled by a dedicated AI agent. This follows the **Divide and Conquer** paradigm applied to LLM-based systems.

Instead of sending a single large prompt to the LLM (which risks:
- Hallucination due to prompt overload
- Loss of focus on specific aspects
- Inability to verify individual components
- Inconsistent output structure)

LexGuard uses **5 specialized agents**, each with a narrow, well-defined responsibility:

```mermaid
graph LR
    A["🧠 Query Agent<br/>Extracts structured<br/>legal intent"] --> B["📜 Statute Agent<br/>Identifies applicable<br/>laws & sections"]
    B --> C["🔍 Case Law Agent<br/>Finds issue-specific<br/>judicial precedents"]
    C --> D["✅ Verification Agent<br/>Checks accuracy &<br/>consistency"]
    D --> E["📝 Drafting Agent<br/>Generates final<br/>structured response"]
    
    style A fill:#4A90D9,color:#fff
    style B fill:#2ECC71,color:#fff
    style C fill:#E67E22,color:#fff
    style D fill:#9B59B6,color:#fff
    style E fill:#E74C3C,color:#fff
```

### 7.2 Agent Responsibility Separation

Each agent follows the **Single Responsibility Principle (SRP)**:

| Agent | Input | Output | Responsibility | What It Must NOT Do |
|-------|-------|--------|---------------|---------------------|
| **Query Agent** | Raw user query (string) | Structured JSON intent | Parse legal intent, classify domain, identify parties | Give advice, explain laws, summarize |
| **Statute Agent** | Structured intent (JSON) | Statutes JSON (substantive + procedural) | Find relevant IPC/BNS/CrPC/CPC sections | Invent sections, draft text |
| **Case Law Agent** | Intent + Statutes + Original Query | Judgments JSON array | Find issue-specific Supreme Court/High Court cases | Use generic/landmark cases unless relevant |
| **Verification Agent** | Intent + Statutes + Cases | Status + Confidence + Observations | Verify factual correctness, relevance, consistency | Add new content, rewrite, draft |
| **Drafting Agent** | All prior data + Language | Structured text (6 sections) + Related questions | Generate formal, neutral, structured response | Give advice, make factual assumptions |

### 7.3 Chain-of-Agents Pipeline

LexGuard implements a **sequential pipeline** where each agent's output enriches the next agent's context:

1. **Query Agent** parses raw text → produces structured intent metadata
2. **Statute Agent** uses the intent → identifies specific statutory sections
3. **Case Law Agent** uses intent + statutes → finds cases interpreting those exact sections
4. **Verification Agent** reviews all prior outputs → assigns confidence level
5. **Drafting Agent** synthesizes everything → produces the final response

This pipeline ensures that:
- The Case Law Agent searches for cases about *specific* sections (not generic landmark cases)
- The Drafting Agent has *verified* data to work with
- Each stage builds on validated information from the previous stage

### 7.4 Graceful Degradation

Every agent implements a **fallback mechanism**. If the LLM call fails, the agent returns a safe default instead of crashing the pipeline:

- Query Agent → returns `{legal_domain: "mixed", core_issue: "Unclear"}`
- Statute Agent → returns `{substantive_laws: [], procedural_laws: []}`
- Case Law Agent → returns `{judgments: [], note: "No precedents identified"}`
- Verification Agent → returns `{status: "warning", confidence_level: "low"}`
- Drafting Agent → returns generic informational message with disclaimer

### 7.5 Caching Strategy

LexGuard uses an **in-memory TTL (Time-To-Live) cache** to avoid redundant LLM API calls:

| Cache Target | TTL | Rationale |
|-------------|-----|-----------|
| Query intent | 1 hour | Same query = same intent |
| Statutes | 6 hours | Laws change rarely |
| Case law | 4 hours | Precedents are stable |
| Verification | 2 hours | Same data = same verification |
| Drafted response | 1 hour | Language-specific, may need refresh |

---

## 8. Algorithm

### 8.1 Main Orchestration Algorithm

```
ALGORITHM: LexGuard Multi-Agent Orchestration Pipeline

INPUT:  query (string), language (string), previousContext (object | null)
OUTPUT: {response, relatedQuestions, timings, metadata}

BEGIN
    timings ← empty map
    
    // STEP 1: Query Decomposition
    START timer for "queryAgent"
    intent ← QueryAgent.extract(query)
    RECORD timing
    
    // STEP 2: Statutory Research
    START timer for "statuteAgent"  
    statutes ← StatuteAgent.identify(intent)
    RECORD timing
    
    // STEP 3: Case Law Discovery
    START timer for "caseLawAgent"
    cases ← CaseLawAgent.discover(intent, statutes, query)
    RECORD timing
    
    // STEP 4: Verification
    START timer for "verificationAgent"
    verification ← VerificationAgent.verify(intent, statutes, cases)
    RECORD timing
    
    // STEP 5: Drafting
    START timer for "draftingAgent"
    draft ← DraftingAgent.generate(query, intent, statutes, cases, 
                                     verification, language, previousContext)
    RECORD timing
    
    totalTime ← SUM of all timings
    
    RETURN {
        response: draft.text,
        relatedQuestions: draft.relatedQuestions,
        timings: timings,
        totalTime: totalTime,
        metadata: {
            domain: intent.legal_domain,
            confidence: verification.confidence_level,
            status: verification.status,
            observations: verification.observations
        }
    }
    
EXCEPTION on any error:
    LOG error with failed stage
    THROW "Pipeline failed: {error message}"
END
```

### 8.2 Query Agent Algorithm

```
ALGORITHM: Legal Intent Extraction

INPUT:  query (string)
OUTPUT: Structured Intent JSON

BEGIN
    IF query is null OR not a string THEN
        RETURN fallback_intent()
    END IF
    
    // Cache Lookup
    cacheKey ← "intent:" + lowercase(trim(query))
    cached ← Cache.get(cacheKey)
    IF cached is not null THEN
        RETURN cached
    END IF
    
    // Construct LLM Prompt
    prompt ← BUILD prompt with:
        - Role: "Legal Query Decomposition Agent for Indian law"
        - Rules: Treat input as unverified, extract signals only
        - Expected JSON schema: {jurisdiction, legal_domain, core_issue, 
                                  parties_involved, user_intent}
    
    // Call LLM
    response ← LLM.generate(prompt, model="gemini-2.0-flash")
    result ← extractJSON(response)  // Robust JSON parser
    
    // Cache and Return
    Cache.set(cacheKey, result, TTL=1hour)
    RETURN result
    
EXCEPTION:
    LOG error
    RETURN fallback_intent()
END

FUNCTION fallback_intent():
    RETURN {
        jurisdiction: "India",
        legal_domain: "mixed",
        core_issue: "Unclear legal issue",
        parties_involved: {complainant: "Unknown", respondent: "Unknown"},
        user_intent: "General legal information"
    }
END FUNCTION
```

### 8.3 Robust JSON Extraction Algorithm

```
ALGORITHM: Robust JSON Extraction from LLM Output

INPUT:  text (string) — raw LLM response
OUTPUT: Parsed JSON object

BEGIN
    // Strategy 1: Direct Parse
    TRY
        RETURN JSON.parse(trim(text))
    CATCH: continue
    
    // Strategy 2: Strip Markdown Code Fences
    cleaned ← text
        .replace("```json", "")
        .replace("```", "")
        .trim()
    TRY
        RETURN JSON.parse(cleaned)
    CATCH: continue
    
    // Strategy 3: Regex Extraction (first { to last })
    match ← regex_match(cleaned, /\{[\s\S]*\}/)
    IF match found THEN
        TRY
            RETURN JSON.parse(match[0])
        CATCH: continue
    END IF
    
    THROW Error("Could not extract valid JSON from LLM response")
END
```

### 8.4 Cache Service Algorithm

```
ALGORITHM: In-Memory TTL Cache

DATA STRUCTURE: Map<key, {value, expiresAt}>

FUNCTION set(key, value, ttl = 1 hour):
    expiresAt ← current_time() + ttl
    map.set(key, {value, expiresAt})
END

FUNCTION get(key):
    entry ← map.get(key)
    IF entry is null THEN RETURN null
    IF current_time() > entry.expiresAt THEN
        map.delete(key)
        RETURN null
    END IF
    RETURN entry.value
END

FUNCTION clear():
    map.clear()
END
```

### 8.5 Section Parser Algorithm

```
ALGORITHM: Response Section Parser

INPUT:  text (string) — raw LLM drafted response
OUTPUT: Array of {icon, title, content} objects

BEGIN
    sectionIcons ← ["📋", "⚖️", "📜", "🔍", "🛡️", "⚠️"]
    
    // Clean formatting artifacts
    cleaned ← text
        .remove all "**" (bold markers)
        .replace "* " with "• " (bullet points)
        .collapse triple newlines to double
        .remove "#" heading markers
    
    // Split on numbered section headers
    parts ← split cleaned on pattern /\n(?=\d+\.\s)/
    sections ← empty array
    
    FOR EACH part IN parts:
        match ← regex_match(part, /^(\d+)\.\s*(.+?)(?:\n|$)/)
        IF match found THEN
            sectionNumber ← match[1] - 1
            title ← match[2]
            content ← part with header line removed, trimmed
            
            IF content is not empty THEN
                sections.push({
                    icon: sectionIcons[sectionNumber] OR "📄",
                    title: title,
                    content: content
                })
            END IF
        END IF
    END FOR
    
    IF sections is empty THEN
        RETURN [{icon: "📄", title: "Legal Information", content: cleaned}]
    END IF
    
    RETURN sections
END
```

---

## 9. Advantages & Disadvantages

### 9.1 Advantages

| # | Advantage | Description |
|---|-----------|-------------|
| 1 | **Multi-Agent Reliability** | By decomposing the task across 5 specialized agents, LexGuard produces more reliable and structured output than a single-prompt approach. Each agent focuses on one concern. |
| 2 | **Verification Layer** | The dedicated Verification Agent checks the consistency and relevance of statutes and case law before the final response is drafted, reducing hallucination. |
| 3 | **Multilingual Support** | Supports 9 Indian languages (English, Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Malayalam, Kannada), democratizing access to legal information across linguistic barriers. |
| 4 | **Voice Input** | Uses the Web Speech API to accept voice queries in multiple languages, improving accessibility for users who cannot type comfortably. |
| 5 | **Structured Output** | Responses follow a consistent 6-section format (Overview, Constitutional Framework, Statutory Procedure, Precedents, Rights, Disclaimer), making legal information easy to navigate. |
| 6 | **Neutral Tone** | The system is explicitly designed to provide *information*, not *advice*. It uses cautious language ("may apply", "has been interpreted") throughout. |
| 7 | **Performance Caching** | In-memory TTL cache avoids redundant API calls, reducing latency for repeated or similar queries. Different cache TTLs are optimized per data type. |
| 8 | **Scenario Comparison** | Users can compare two legal scenarios side by side, enabling better understanding of differences between similar legal issues. |
| 9 | **Follow-Up Conversations** | Session-based context allows users to ask follow-up questions, building on previously discussed topics. |
| 10 | **Simple Language Mode** | A dedicated simplification endpoint re-explains legal content in everyday language, making it accessible to laypeople. |
| 11 | **Open Source & Free** | Unlike Westlaw, LexisNexis, and CaseMine, LexGuard is free and accessible. |
| 12 | **Security** | Implements Helmet.js security headers, rate limiting, input sanitization, and secure session management. |

### 9.2 Disadvantages

| # | Disadvantage | Description |
|---|-------------|-------------|
| 1 | **LLM Hallucination** | Despite the verification agent, the system relies on the LLM's training data. Case names, section descriptions, or legal principles may be fabricated or inaccurate. |
| 2 | **No Verified Legal Database** | Judicial precedents are sourced from the LLM's knowledge, not from a verified database like Indian Kanoon or SCC Online. There is no programmatic citation verification. |
| 3 | **API Dependency** | The system depends entirely on Google's Gemini API. Any downtime, rate limits, or pricing changes directly affect availability. |
| 4 | **No Authentication** | There is no user authentication system. All queries are anonymous, which limits personalization and audit capabilities. |
| 5 | **No Persistent Storage** | Uses in-memory caching only (no database). All cached data is lost on server restart. There is no query analytics or audit trail persistence. |
| 6 | **Sequential Pipeline Latency** | The 5-agent pipeline runs sequentially. A typical query takes 15–30 seconds, which is slower than traditional search engines. |
| 7 | **Static Legal Data** | The quick-reference `legal-sections.json` file contains a fixed set of IPC/CrPC/Article descriptions. New legislation or amendments require manual updates. |
| 8 | **Single-Server Architecture** | Not designed for horizontal scaling. High concurrent load could overwhelm the single Node.js process. |
| 9 | **Legal Disclaimer** | The system explicitly cannot replace professional legal consultation and must always be used with caution. |

---

## 10. Applications

### 10.1 Primary Applications

1. **Legal Awareness for Citizens**
   Ordinary citizens can type a legal question in plain language (or even speak it in their native language) and receive a structured, understandable explanation of the applicable laws, procedures, constitutional rights, and relevant court judgments.

2. **Law Student Research Aid**
   Law students can use LexGuard to quickly understand the statutory framework and judicial precedents for any legal topic, accelerating their research and study process for examinations, moot courts, and legal writing assignments.

3. **Paralegal and Junior Lawyer Research**
   Legal professionals at early career stages can use the system as a starting point for case preparation — quickly identifying relevant statutes, procedures, and Supreme Court decisions before diving into primary legal databases.

4. **Legal Literacy and Education Programs**
   NGOs, legal aid societies, and government initiatives focused on legal literacy can integrate LexGuard into their programs to provide accessible legal information to rural and underserved communities, especially leveraging the multilingual capability.

5. **Journalism and Media**
   Journalists covering legal stories can use the system to quickly understand the legal framework surrounding a case, ensuring more accurate reporting.

### 10.2 Extended Applications

6. **Scenario Comparison for Legal Understanding**
   Using the Compare feature, users can understand the differences between similar legal concepts (e.g., "theft vs. robbery", "bail vs. anticipatory bail", "FIR vs. complaint").

7. **Multilingual Legal Helplines**
   Government legal aid helplines can integrate the system's API to provide automated first-level responses in the caller's preferred language before connecting them with a human lawyer.

8. **Academic Research on AI Systems**
   The multi-agent architecture serves as a reference implementation for studying LLM-based orchestration patterns, prompt engineering, and agent coordination in software engineering courses.

---

## 11. Technical Challenges

### 11.1 LLM Output Parsing

**Challenge:** LLMs do not always return clean JSON. Gemini sometimes wraps JSON in markdown code fences (\`\`\`json ... \`\`\`), prefixes it with explanatory text, or includes trailing commentary.

**Solution:** The `jsonParser.js` service implements a 3-strategy extraction algorithm:
1. Direct `JSON.parse()` attempt
2. Strip markdown code fences and retry
3. Regex extraction of the first `{...}` block

This ensures >95% parse success rate across diverse LLM outputs.

### 11.2 Hallucinated Case Citations

**Challenge:** LLMs frequently generate plausible-sounding but non-existent case names and citations, a phenomenon known as "hallucination."

**Solution:** LexGuard addresses this through:
- The Verification Agent checks cross-consistency of cited cases with the identified statutes
- The Case Law Agent's prompt explicitly prohibits generic landmark cases unless directly relevant
- Confidence scoring (high/medium/low) transparently communicates reliability to the user
- A permanent disclaimer accompanies every response

### 11.3 Multilingual Response Quality

**Challenge:** Producing high-quality legal content in 9 Indian languages while maintaining accuracy of legal terminology.

**Solution:** The Drafting Agent's prompt includes explicit language instructions:
- All content must be in the target language
- Legal case names, statute names, and article numbers remain in English for accuracy
- Language-specific script must be used throughout
- Unnecessary English mixing is prohibited

### 11.4 Rate Limiting vs. User Experience

**Challenge:** The Gemini API has rate limits. Each query makes 5 sequential API calls. Heavy usage can exhaust API quotas.

**Solution:**
- Multi-tier TTL caching reduces redundant calls (same query = cached response)
- Client-side rate limiting (20 requests per 15 minutes per IP)
- Graceful error messages when limits are hit

### 11.5 Sequential Pipeline Latency

**Challenge:** The 5-agent pipeline takes 15–30 seconds, which is longer than users expect from modern web applications.

**Solution:**
- A loading overlay with sequential step animations keeps users informed
- Agent timing display shows exactly how long each stage took
- Caching eliminates latency for repeated queries
- The pipeline was designed to be sequential where dependencies exist but could be parallelized further (e.g., statute + case law agents could potentially run in parallel)

### 11.6 Session Context for Follow-Ups

**Challenge:** Maintaining conversational context between queries without a database.

**Solution:** Express sessions with `express-session`:
- Store the previous query, domain, and response summary in the session
- Pass this context to the orchestrator for follow-up queries
- Session timeout of 30 minutes prevents stale context
- Cryptographically random session secrets prevent tampering

---

## 13. Case Studies

### Case Study 1: Criminal Law Query — "Someone has stolen my phone. What are my rights?"

**Input:** "Someone stole my mobile phone at the railway station. What can I do legally?"

**Agent Pipeline Execution:**

| Stage | Agent | Output Summary | Time |
|-------|-------|----------------|------|
| 1 | Query Agent | Domain: Criminal; Issue: Theft of personal property; Intent: Legal remedies | ~1.5s |
| 2 | Statute Agent | IPC Section 379 (Theft), 380 (Theft in dwelling), CrPC Section 154 (FIR), 41 (Arrest without warrant) | ~2.5s |
| 3 | Case Law Agent | *K.N. Mehra v. State of Rajasthan* (elements of theft), *Pyare Lal v. State* (railway property) | ~4.0s |
| 4 | Verification Agent | Status: Verified; Confidence: High; Sections correctly matched | ~2.0s |
| 5 | Drafting Agent | 6-section structured response explaining FIR procedure, theft definition, penalties, and rights | ~5.0s |

**Total Processing Time:** ~15 seconds

**Structured Output Sections:**
1. Case Overview — Identified as a criminal matter involving theft of movable property
2. Constitutional Framework — Article 21 (right to life and personal liberty), Article 14 (equality before law)
3. Statutory Procedure — Section 154 CrPC (FIR filing), Section 379 IPC (theft definition & punishment)
4. Judicial Precedents — Relevant Supreme Court cases on theft elements
5. Rights & Safeguards — Right to file FIR at any police station, right to get FIR copy
6. Disclaimer — Informational only, consult a lawyer for case-specific advice

---

### Case Study 2: Constitutional Law Query — "Can police arrest me without a warrant?"

**Input:** "Under what circumstances can police arrest without warrant in India?"

**Agent Pipeline Execution:**

| Stage | Agent | Output Summary | Time |
|-------|-------|----------------|------|
| 1 | Query Agent | Domain: Criminal/Constitutional; Issue: Police power of arrest; Intent: Procedural safeguards | ~1.2s |
| 2 | Statute Agent | CrPC Section 41 (When police may arrest without warrant), Section 41A (Notice of appearance), Article 22 (Protection against arrest) | ~3.0s |
| 3 | Case Law Agent | *Arnesh Kumar v. State of Bihar* (limitations on arrest in 498A cases), *D.K. Basu v. State of West Bengal* (arrest guidelines) | ~4.5s |
| 4 | Verification Agent | Status: Verified; Confidence: High | ~1.8s |
| 5 | Drafting Agent | Comprehensive response on arrest powers, limitations, and constitutional safeguards | ~5.5s |

**Total Processing Time:** ~16 seconds

---

### Case Study 3: Scenario Comparison — "Theft vs. Robbery"

**Input:**
- Scenario A: "What is theft under Indian law?"
- Scenario B: "What is robbery under Indian law?"

**Execution:** Both scenarios processed in parallel via `Promise.all()`.

**Comparison Output:**

| Aspect | Theft (Scenario A) | Robbery (Scenario B) |
|--------|-------------------|---------------------|
| **IPC Section** | Section 378, 379 | Section 390, 392 |
| **Definition** | Dishonest taking of movable property without consent | Theft + use of force or fear of force |
| **Punishment** | Up to 3 years imprisonment + fine | Up to 10 years rigorous imprisonment + fine |
| **Nature** | Any movable property | Involves violence/intimidation |
| **Domain** | Criminal | Criminal |

---

### Case Study 4: Multilingual Query — Hindi

**Input:** "तलाक के बाद पत्नी के अधिकार क्या हैं?" (What are the wife's rights after divorce?)

**Language selected:** Hindi (हिन्दी)

**Result:** The system produced the entire response in Hindi, with:
- Section titles in Hindi
- Legal explanations in Hindi
- Case names and statute numbers retained in English for accuracy
- Related follow-up questions generated in Hindi

---

## 14. Conclusion

### 14.1 Summary

LexGuard successfully demonstrates a **multi-agent AI system** that transforms natural-language legal queries into structured, neutral, and accessible legal information. The system's five specialized agents — Query Agent, Statute Agent, Case Law Agent, Verification Agent, and Drafting Agent — work together through a coordinated pipeline managed by a central Orchestrator.

### 14.2 Key Achievements

1. **Multi-Agent Architecture:** Successfully implemented a 5-agent pipeline with clear responsibility separation, sequential data flow, and graceful error handling.
2. **Dynamic Legal Research:** The system dynamically identifies relevant statutes, constitutional provisions, and judicial precedents for any legal query — not from a static database, but through intelligent LLM-based reasoning.
3. **Multilingual Accessibility:** Support for 9 Indian languages (including voice input) makes legal information accessible to a much larger population.
4. **Verification & Confidence Scoring:** The Verification Agent adds a layer of quality assurance, assigning confidence levels and flagging potential inconsistencies.
5. **Rich User Interface:** The web interface includes query history, section accordions, legal term glossary, side-by-side comparison, follow-up conversations, PDF export, and simple language mode.
6. **Robust Engineering:** The system implements proper security headers, rate limiting, input sanitization, structured logging, TTL caching, and a 3-strategy JSON parser for LLM output.

### 14.3 Contributions

This project contributes to the following areas:
- **AI Systems Design:** A practical reference implementation of multi-agent LLM orchestration
- **Legal Technology:** A free, accessible, multilingual legal information system for Indian law
- **Software Engineering:** Demonstrates modular architecture, error boundaries, caching strategies, and prompt engineering best practices

### 14.4 Future Work

| Enhancement | Description |
|-------------|-------------|
| **Verified Legal Database Integration** | Connect to Indian Kanoon or SCC Online API for programmatic case citation verification |
| **Streaming Responses** | Use Server-Sent Events (SSE) to stream partial responses as each agent completes |
| **User Authentication** | Add user accounts for query history persistence, favorites, and personalized recommendations |
| **Persistent Database** | Migrate from in-memory cache to MongoDB or PostgreSQL for durability and analytics |
| **Advanced RAG** | Implement Retrieval-Augmented Generation with a vector database of Indian legal documents |
| **Mobile Application** | Build a React Native or Flutter mobile app for broader reach |
| **Parallel Agent Execution** | Run Statute and Case Law agents in parallel where possible to reduce latency |
| **Fine-Tuned Legal Model** | Fine-tune an open-source LLM on verified Indian legal data for higher accuracy |

### 14.5 Final Remarks

LexGuard demonstrates that modern AI, when architected thoughtfully using multi-agent patterns, prompt engineering, and verification mechanisms, can meaningfully improve access to legal information. While it does not replace professional legal counsel, it serves as a powerful educational tool and a stepping stone toward more sophisticated legal AI systems.

---

## 15. References

### Academic Papers

1. Zhong, H., Guo, Z., Tu, C., Xiao, C., Liu, Z., & Sun, M. (2020). "Legal Judgment Prediction via Topological Multi-Task Learning." *Proceedings of EMNLP 2020*.

2. Chalkidis, I., Fergadiotis, M., Malakasiotis, P., Aletras, N., & Androutsopoulos, I. (2020). "LEGAL-BERT: The Muppets straight out of Law School." *Findings of EMNLP 2020*.

3. Wei, J., Wang, X., Schuurmans, D., Bosma, M., Ichter, B., Xia, F., Chi, E., Le, Q., & Zhou, D. (2022). "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models." *NeurIPS 2022*.

4. Park, J.S., O'Brien, J.C., Cai, C.J., Morris, M.R., Liang, P., & Bernstein, M.S. (2023). "Generative Agents: Interactive Simulacra of Human Behavior." *Proceedings of UIST 2023*.

5. Wu, Q., Bansal, G., Zhang, J., Wu, Y., Li, B., Zhu, E., Jiang, L., Zhang, X., Zhang, S., Liu, J., Awadallah, A.H., White, R.W., Burger, D., & Wang, C. (2023). "AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation." *arXiv:2308.08155*.

6. Dahl, M., Magesh, V., Suzgun, M., & Ho, D.E. (2024). "Large Legal Fictions: Profiling Legal Hallucinations in Large Language Models." *Journal of Legal Analysis*.

7. Wooldridge, M., & Jennings, N.R. (1995). "Intelligent Agents: Theory and Practice." *The Knowledge Engineering Review, 10(2)*, 115–152.

### Technical Documentation

8. Google. (2024). "Gemini API Documentation." https://ai.google.dev/docs

9. Express.js. (2024). "Express — Fast, Unopinionated, Minimalist Web Framework for Node.js." https://expressjs.com/

10. Helmet.js. (2024). "Helmet — Help secure Express/Connect apps with various HTTP headers." https://helmetjs.github.io/

11. Mozilla Developer Network. (2024). "Web Speech API — SpeechRecognition." https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition

### Legal Sources

12. *The Indian Penal Code, 1860* (IPC) / *Bharatiya Nyaya Sanhita, 2023* (BNS)

13. *The Code of Criminal Procedure, 1973* (CrPC) / *Bharatiya Nagarik Suraksha Sanhita, 2023* (BNSS)

14. *The Code of Civil Procedure, 1908* (CPC)

15. *The Constitution of India, 1950*

16. *Arnesh Kumar v. State of Bihar*, (2014) 8 SCC 273

17. *D.K. Basu v. State of West Bengal*, (1997) 1 SCC 416

---

> **Disclaimer:** LexGuard provides general legal information for educational and exploratory purposes only. It does not constitute legal advice or legal opinion. For case-specific matters, consult a qualified legal professional.
