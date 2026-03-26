/**
 * Study Guide Topic Planner
 *
 * Seeds the study_guide_topics collection with 175+ topics for AI-powered
 * study guide generation across campus placement preparation areas.
 *
 * Usage:
 *   node --env-file=.env scripts/study-guide-planner.mjs
 *   node --env-file=.env scripts/study-guide-planner.mjs --dry-run
 *   node --env-file=.env scripts/study-guide-planner.mjs --reset
 *   node --env-file=.env scripts/study-guide-planner.mjs --category=aptitude
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";

const COLLECTION = "study_guide_topics";

// ─── Topic Database ────────────────────────────────────────────────

const TOPICS = {
  aptitude: {
    quantitative: [
      { name: "Number Systems", priority: 1, estimated_word_count: 2000, difficulty_range: ["beginner", "intermediate"] },
      { name: "HCF and LCM", priority: 1, estimated_word_count: 1500, difficulty_range: ["beginner", "intermediate"] },
      { name: "Percentages", priority: 1, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "Profit and Loss", priority: 1, estimated_word_count: 2000, difficulty_range: ["beginner", "intermediate"] },
      { name: "Simple Interest", priority: 2, estimated_word_count: 1500, difficulty_range: ["beginner"] },
      { name: "Compound Interest", priority: 1, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "Ratio and Proportion", priority: 1, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "Averages", priority: 2, estimated_word_count: 1500, difficulty_range: ["beginner"] },
      { name: "Mixtures and Alligations", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
      { name: "Time and Work", priority: 1, estimated_word_count: 2200, difficulty_range: ["beginner", "intermediate"] },
      { name: "Pipes and Cisterns", priority: 2, estimated_word_count: 1500, difficulty_range: ["beginner", "intermediate"] },
      { name: "Time Speed and Distance", priority: 1, estimated_word_count: 2200, difficulty_range: ["beginner", "intermediate", "advanced"] },
      { name: "Trains", priority: 1, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "Boats and Streams", priority: 2, estimated_word_count: 1500, difficulty_range: ["beginner", "intermediate"] },
      { name: "Permutations and Combinations", priority: 1, estimated_word_count: 2500, difficulty_range: ["intermediate", "advanced"] },
      { name: "Probability", priority: 1, estimated_word_count: 2500, difficulty_range: ["intermediate", "advanced"] },
      { name: "Algebra Basics", priority: 1, estimated_word_count: 2000, difficulty_range: ["beginner", "intermediate"] },
      { name: "Quadratic Equations", priority: 2, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
      { name: "Progressions AP and GP", priority: 1, estimated_word_count: 2000, difficulty_range: ["beginner", "intermediate"] },
      { name: "Set Theory and Venn Diagrams", priority: 2, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
      { name: "Logarithms", priority: 2, estimated_word_count: 1500, difficulty_range: ["intermediate"] },
      { name: "Mensuration 2D", priority: 1, estimated_word_count: 2000, difficulty_range: ["beginner", "intermediate"] },
      { name: "Mensuration 3D", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
      { name: "Data Interpretation", priority: 1, estimated_word_count: 2200, difficulty_range: ["intermediate", "advanced"] },
      { name: "Number Properties and Divisibility", priority: 1, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "Surds and Indices", priority: 2, estimated_word_count: 1500, difficulty_range: ["intermediate"] },
      { name: "Ages Problems", priority: 2, estimated_word_count: 1500, difficulty_range: ["beginner"] },
      { name: "Partnership", priority: 3, estimated_word_count: 1200, difficulty_range: ["beginner", "intermediate"] },
    ],
    logical: [
      { name: "Number Series", priority: 1, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "Letter and Symbol Series", priority: 2, estimated_word_count: 1500, difficulty_range: ["beginner"] },
      { name: "Coding and Decoding", priority: 1, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "Blood Relations", priority: 1, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "Direction Sense", priority: 2, estimated_word_count: 1500, difficulty_range: ["beginner"] },
      { name: "Seating Arrangement Linear", priority: 1, estimated_word_count: 2200, difficulty_range: ["intermediate", "advanced"] },
      { name: "Seating Arrangement Circular", priority: 1, estimated_word_count: 2200, difficulty_range: ["intermediate", "advanced"] },
      { name: "Syllogisms", priority: 1, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
      { name: "Puzzles and Logic", priority: 1, estimated_word_count: 2500, difficulty_range: ["intermediate", "advanced"] },
      { name: "Clocks and Calendars", priority: 2, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "Analogies", priority: 1, estimated_word_count: 1500, difficulty_range: ["beginner", "intermediate"] },
      { name: "Classification and Odd One Out", priority: 2, estimated_word_count: 1200, difficulty_range: ["beginner"] },
      { name: "Statement and Assumption", priority: 2, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
      { name: "Statement and Conclusion", priority: 2, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
      { name: "Data Sufficiency", priority: 1, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
      { name: "Cubes and Dice", priority: 2, estimated_word_count: 1500, difficulty_range: ["intermediate"] },
      { name: "Input Output Tracing", priority: 2, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
    ],
    verbal: [
      { name: "Synonyms and Antonyms", priority: 1, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "Sentence Completion", priority: 1, estimated_word_count: 1500, difficulty_range: ["intermediate"] },
      { name: "Reading Comprehension", priority: 1, estimated_word_count: 2200, difficulty_range: ["intermediate", "advanced"] },
      { name: "Error Detection in Sentences", priority: 1, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
      { name: "Para Jumbles", priority: 2, estimated_word_count: 1500, difficulty_range: ["intermediate"] },
      { name: "Sentence Improvement", priority: 2, estimated_word_count: 1500, difficulty_range: ["intermediate"] },
      { name: "Idioms and Phrases", priority: 2, estimated_word_count: 1500, difficulty_range: ["beginner", "intermediate"] },
      { name: "One Word Substitution", priority: 2, estimated_word_count: 1200, difficulty_range: ["beginner"] },
      { name: "Active Passive Voice", priority: 1, estimated_word_count: 1500, difficulty_range: ["beginner", "intermediate"] },
      { name: "Direct Indirect Speech", priority: 1, estimated_word_count: 1500, difficulty_range: ["beginner", "intermediate"] },
      { name: "Cloze Test", priority: 2, estimated_word_count: 1500, difficulty_range: ["intermediate"] },
      { name: "Verbal Analogies", priority: 3, estimated_word_count: 1200, difficulty_range: ["beginner"] },
    ],
  },

  technical: {
    programming: [
      { name: "C Language Basics and Syntax", priority: 1, estimated_word_count: 2500, difficulty_range: ["beginner", "intermediate"] },
      { name: "C Pointers and Memory", priority: 1, estimated_word_count: 2500, difficulty_range: ["intermediate", "advanced"] },
      { name: "C Arrays and Strings", priority: 1, estimated_word_count: 2000, difficulty_range: ["beginner", "intermediate"] },
      { name: "C Structures and Unions", priority: 2, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
      { name: "C File Handling", priority: 3, estimated_word_count: 1500, difficulty_range: ["intermediate"] },
      { name: "Java Fundamentals and OOP", priority: 1, estimated_word_count: 2500, difficulty_range: ["beginner", "intermediate"] },
      { name: "Java Inheritance and Polymorphism", priority: 1, estimated_word_count: 2200, difficulty_range: ["intermediate"] },
      { name: "Java Abstract Classes and Interfaces", priority: 1, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
      { name: "Java Exception Handling", priority: 1, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
      { name: "Java Collections Framework", priority: 1, estimated_word_count: 2500, difficulty_range: ["intermediate", "advanced"] },
      { name: "Java String Handling", priority: 1, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "Java Multithreading Basics", priority: 2, estimated_word_count: 2000, difficulty_range: ["advanced"] },
      { name: "Python Basics and Data Types", priority: 1, estimated_word_count: 2000, difficulty_range: ["beginner"] },
      { name: "Python Functions and Modules", priority: 1, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "Python OOP Concepts", priority: 1, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "Python List Comprehensions and Generators", priority: 2, estimated_word_count: 1800, difficulty_range: ["intermediate", "advanced"] },
      { name: "Python File and Exception Handling", priority: 2, estimated_word_count: 1500, difficulty_range: ["intermediate"] },
      { name: "Object Oriented Programming Concepts", priority: 1, estimated_word_count: 2500, difficulty_range: ["beginner", "intermediate", "advanced"] },
      { name: "Pseudocode and Flowcharts", priority: 1, estimated_word_count: 1800, difficulty_range: ["beginner"] },
      { name: "Bitwise Operators and Bit Manipulation", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
    ],
    data_structures: [
      { name: "Arrays One and Two Dimensional", priority: 1, estimated_word_count: 2200, difficulty_range: ["beginner", "intermediate"] },
      { name: "Strings and String Algorithms", priority: 1, estimated_word_count: 2200, difficulty_range: ["intermediate"] },
      { name: "Linked Lists Singly and Doubly", priority: 1, estimated_word_count: 2500, difficulty_range: ["intermediate", "advanced"] },
      { name: "Stacks and Applications", priority: 1, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "Queues and Variants", priority: 1, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "Binary Trees", priority: 1, estimated_word_count: 2500, difficulty_range: ["intermediate", "advanced"] },
      { name: "Binary Search Trees", priority: 1, estimated_word_count: 2200, difficulty_range: ["intermediate", "advanced"] },
      { name: "Heaps and Priority Queues", priority: 1, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
      { name: "Hashing and Hash Tables", priority: 1, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "Graphs Representation and Traversal", priority: 1, estimated_word_count: 2500, difficulty_range: ["advanced"] },
      { name: "Tries", priority: 2, estimated_word_count: 1800, difficulty_range: ["advanced"] },
      { name: "Segment Trees and Fenwick Trees", priority: 3, estimated_word_count: 2000, difficulty_range: ["advanced"] },
    ],
    algorithms: [
      { name: "Sorting Algorithms Comparison", priority: 1, estimated_word_count: 2500, difficulty_range: ["intermediate", "advanced"] },
      { name: "Searching Algorithms", priority: 1, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "Recursion Fundamentals", priority: 1, estimated_word_count: 2200, difficulty_range: ["intermediate"] },
      { name: "Dynamic Programming Basics", priority: 1, estimated_word_count: 2500, difficulty_range: ["advanced"] },
      { name: "Greedy Algorithms", priority: 1, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
      { name: "Backtracking", priority: 2, estimated_word_count: 2200, difficulty_range: ["advanced"] },
      { name: "Divide and Conquer", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
      { name: "Graph Algorithms BFS DFS", priority: 1, estimated_word_count: 2500, difficulty_range: ["advanced"] },
      { name: "Shortest Path Algorithms", priority: 2, estimated_word_count: 2200, difficulty_range: ["advanced"] },
      { name: "Minimum Spanning Tree", priority: 2, estimated_word_count: 1800, difficulty_range: ["advanced"] },
      { name: "Time and Space Complexity Analysis", priority: 1, estimated_word_count: 2000, difficulty_range: ["beginner", "intermediate"] },
      { name: "Two Pointer and Sliding Window", priority: 1, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
    ],
    dbms: [
      { name: "SQL Basics SELECT INSERT UPDATE DELETE", priority: 1, estimated_word_count: 2200, difficulty_range: ["beginner", "intermediate"] },
      { name: "SQL Joins Inner Outer Cross", priority: 1, estimated_word_count: 2200, difficulty_range: ["intermediate"] },
      { name: "SQL Subqueries and Nested Queries", priority: 1, estimated_word_count: 1800, difficulty_range: ["intermediate", "advanced"] },
      { name: "SQL Aggregate Functions and GROUP BY", priority: 1, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
      { name: "Database Normalization 1NF to BCNF", priority: 1, estimated_word_count: 2500, difficulty_range: ["intermediate", "advanced"] },
      { name: "ER Diagrams and Schema Design", priority: 1, estimated_word_count: 2000, difficulty_range: ["beginner", "intermediate"] },
      { name: "Transactions ACID Properties", priority: 1, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "Indexing and Query Optimization", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
      { name: "Relational Algebra", priority: 2, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
      { name: "NoSQL Basics and MongoDB Overview", priority: 3, estimated_word_count: 1500, difficulty_range: ["beginner"] },
    ],
    os: [
      { name: "Process Management and PCB", priority: 1, estimated_word_count: 2200, difficulty_range: ["intermediate"] },
      { name: "CPU Scheduling Algorithms", priority: 1, estimated_word_count: 2500, difficulty_range: ["intermediate", "advanced"] },
      { name: "Process Synchronization", priority: 1, estimated_word_count: 2200, difficulty_range: ["intermediate", "advanced"] },
      { name: "Deadlocks Detection and Prevention", priority: 1, estimated_word_count: 2500, difficulty_range: ["intermediate", "advanced"] },
      { name: "Memory Management Paging and Segmentation", priority: 1, estimated_word_count: 2500, difficulty_range: ["intermediate", "advanced"] },
      { name: "Virtual Memory and Page Replacement", priority: 1, estimated_word_count: 2200, difficulty_range: ["advanced"] },
      { name: "File Systems and Disk Scheduling", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "Threads and Concurrency", priority: 1, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "Inter Process Communication", priority: 2, estimated_word_count: 1800, difficulty_range: ["intermediate", "advanced"] },
      { name: "Linux Commands for Interviews", priority: 1, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
    ],
    networks: [
      { name: "OSI Model and Layers", priority: 1, estimated_word_count: 2200, difficulty_range: ["beginner", "intermediate"] },
      { name: "TCP IP Protocol Suite", priority: 1, estimated_word_count: 2200, difficulty_range: ["intermediate"] },
      { name: "IP Addressing and Subnetting", priority: 1, estimated_word_count: 2500, difficulty_range: ["intermediate", "advanced"] },
      { name: "TCP vs UDP", priority: 1, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "HTTP HTTPS and Web Protocols", priority: 1, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "DNS and DHCP", priority: 2, estimated_word_count: 1500, difficulty_range: ["intermediate"] },
      { name: "Routing Protocols", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
      { name: "Network Security Basics", priority: 2, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
      { name: "Socket Programming Concepts", priority: 3, estimated_word_count: 1500, difficulty_range: ["advanced"] },
      { name: "Data Link Layer and MAC", priority: 2, estimated_word_count: 1500, difficulty_range: ["intermediate"] },
    ],
    software_engineering: [
      { name: "SDLC Models Waterfall Agile Scrum", priority: 1, estimated_word_count: 2000, difficulty_range: ["beginner", "intermediate"] },
      { name: "Software Testing Types", priority: 1, estimated_word_count: 2000, difficulty_range: ["beginner", "intermediate"] },
      { name: "Design Patterns Overview", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
      { name: "Version Control Git Basics", priority: 1, estimated_word_count: 1800, difficulty_range: ["beginner"] },
      { name: "UML Diagrams", priority: 2, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
    ],
  },

  company_specific: {
    company_prep: [
      { name: "TCS NQT Pattern and Strategy", priority: 1, estimated_word_count: 2500, difficulty_range: ["beginner", "intermediate"] },
      { name: "TCS Digital Advanced Aptitude", priority: 1, estimated_word_count: 2200, difficulty_range: ["intermediate", "advanced"] },
      { name: "Infosys InfyTQ Preparation Guide", priority: 1, estimated_word_count: 2500, difficulty_range: ["beginner", "intermediate"] },
      { name: "Infosys SP and DSE Strategy", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
      { name: "Wipro NLTH Test Pattern", priority: 1, estimated_word_count: 2200, difficulty_range: ["beginner", "intermediate"] },
      { name: "Wipro Turbo and Elite Preparation", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
      { name: "Cognizant GenC and GenC Next", priority: 1, estimated_word_count: 2200, difficulty_range: ["beginner", "intermediate"] },
      { name: "Accenture Assessment Pattern", priority: 1, estimated_word_count: 2200, difficulty_range: ["beginner", "intermediate"] },
      { name: "Capgemini Pseudocode and Game Based", priority: 1, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "HCLTech Placement Preparation", priority: 2, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "Tech Mahindra Placement Guide", priority: 2, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "LTIMindtree Placement Strategy", priority: 2, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
      { name: "Deloitte Placement Preparation", priority: 2, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
      { name: "Zoho Recruitment Process", priority: 1, estimated_word_count: 2200, difficulty_range: ["intermediate", "advanced"] },
      { name: "Amazon SDE Intern Preparation", priority: 2, estimated_word_count: 2500, difficulty_range: ["advanced"] },
      { name: "Microsoft Campus Hiring Guide", priority: 2, estimated_word_count: 2500, difficulty_range: ["advanced"] },
      { name: "Goldman Sachs Aptitude and Coding", priority: 3, estimated_word_count: 2000, difficulty_range: ["advanced"] },
      { name: "Service Based vs Product Based Comparison", priority: 1, estimated_word_count: 2000, difficulty_range: ["beginner"] },
    ],
  },

  soft_skills: {
    interview: [
      { name: "Tell Me About Yourself", priority: 1, estimated_word_count: 2000, difficulty_range: ["beginner"] },
      { name: "HR Interview Top 30 Questions", priority: 1, estimated_word_count: 2500, difficulty_range: ["beginner", "intermediate"] },
      { name: "Strengths and Weaknesses Answer", priority: 1, estimated_word_count: 1500, difficulty_range: ["beginner"] },
      { name: "Technical Interview Tips", priority: 1, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "Group Discussion Strategies", priority: 1, estimated_word_count: 2000, difficulty_range: ["beginner", "intermediate"] },
      { name: "STAR Method for Behavioral Questions", priority: 2, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
      { name: "Salary Negotiation for Freshers", priority: 3, estimated_word_count: 1500, difficulty_range: ["beginner"] },
    ],
    career: [
      { name: "Resume Building for Freshers", priority: 1, estimated_word_count: 2000, difficulty_range: ["beginner"] },
      { name: "LinkedIn Profile Optimization", priority: 2, estimated_word_count: 1500, difficulty_range: ["beginner"] },
      { name: "Email Etiquette for Placements", priority: 2, estimated_word_count: 1200, difficulty_range: ["beginner"] },
      { name: "Placement Season Timeline and Strategy", priority: 1, estimated_word_count: 2000, difficulty_range: ["beginner"] },
      { name: "Body Language in Interviews", priority: 2, estimated_word_count: 1500, difficulty_range: ["beginner"] },
      { name: "How to Crack Off-Campus Placements", priority: 2, estimated_word_count: 1800, difficulty_range: ["beginner", "intermediate"] },
    ],
  },

  branch_core: {
    cse: [
      { name: "Compiler Design Basics", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
      { name: "Theory of Computation", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
      { name: "Computer Architecture Basics", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "Digital Logic Design", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
    ],
    ece: [
      { name: "Digital Electronics Fundamentals", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "Signals and Systems Overview", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
      { name: "Communication Systems Basics", priority: 2, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
      { name: "Microprocessors and Microcontrollers", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "Analog Circuits for Interviews", priority: 3, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
    ],
    mechanical: [
      { name: "Engineering Mechanics Statics", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "Thermodynamics for Interviews", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "Strength of Materials Basics", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "Manufacturing Processes Overview", priority: 2, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
      { name: "Fluid Mechanics Fundamentals", priority: 3, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
    ],
    electrical: [
      { name: "Circuit Theory Basics", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "Electrical Machines Overview", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "Power Systems Fundamentals", priority: 3, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
      { name: "Control Systems Basics", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate", "advanced"] },
    ],
    civil: [
      { name: "Structural Analysis Basics", priority: 2, estimated_word_count: 2000, difficulty_range: ["intermediate"] },
      { name: "Geotechnical Engineering Overview", priority: 3, estimated_word_count: 1800, difficulty_range: ["intermediate"] },
      { name: "Surveying Fundamentals", priority: 3, estimated_word_count: 1500, difficulty_range: ["intermediate"] },
      { name: "Construction Materials", priority: 3, estimated_word_count: 1500, difficulty_range: ["beginner", "intermediate"] },
    ],
  },
};

// ─── Flatten topics ────────────────────────────────────────────────

function flattenTopics(categoryFilter) {
  const results = [];

  for (const [category, subcategories] of Object.entries(TOPICS)) {
    if (categoryFilter && category !== categoryFilter) continue;

    for (const [subcategory, topics] of Object.entries(subcategories)) {
      for (const topic of topics) {
        results.push({
          id: randomUUID(),
          name: topic.name,
          category,
          subcategory,
          priority: topic.priority,
          estimated_word_count: topic.estimated_word_count,
          difficulty_range: topic.difficulty_range,
          created_at: new Date().toISOString(),
        });
      }
    }
  }

  return results;
}

// ─── CLI ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const reset = args.includes("--reset");
const categoryArg = args.find((a) => a.startsWith("--category="));
const categoryFilter = categoryArg ? categoryArg.split("=")[1] : null;

async function main() {
  const allTopics = flattenTopics(categoryFilter);

  console.log(`\n=== Study Guide Topic Planner ===`);
  console.log(`Total topics: ${allTopics.length}`);

  // Category breakdown
  const catCounts = {};
  for (const t of allTopics) {
    catCounts[t.category] = (catCounts[t.category] || 0) + 1;
  }
  console.log("\nCategory breakdown:");
  for (const [cat, count] of Object.entries(catCounts)) {
    console.log(`  ${cat}: ${count}`);
  }

  // Priority breakdown
  const priCounts = { 1: 0, 2: 0, 3: 0 };
  for (const t of allTopics) {
    priCounts[t.priority] = (priCounts[t.priority] || 0) + 1;
  }
  console.log("\nPriority breakdown:");
  console.log(`  Priority 1 (Core): ${priCounts[1]}`);
  console.log(`  Priority 2 (Important): ${priCounts[2]}`);
  console.log(`  Priority 3 (Optional): ${priCounts[3]}`);

  // Cost estimation
  const avgTokensPerGuide = 5000;
  const costPerGuideUsd = avgTokensPerGuide * 0.4 / 1_000_000; // Gemini Flash output
  const totalCostUsd = allTopics.length * costPerGuideUsd;
  const totalCostInr = totalCostUsd * 84;
  console.log(`\nEstimated generation cost:`);
  console.log(`  Per guide: $${costPerGuideUsd.toFixed(4)} (~₹${(costPerGuideUsd * 84).toFixed(2)})`);
  console.log(`  All ${allTopics.length} guides: $${totalCostUsd.toFixed(2)} (~₹${totalCostInr.toFixed(0)})`);

  if (dryRun) {
    console.log("\n[DRY RUN] No database changes made.\n");
    console.log("Topics that would be seeded:");
    for (const t of allTopics) {
      console.log(`  [P${t.priority}] ${t.category} > ${t.subcategory} > ${t.name}`);
    }
    return;
  }

  // Connect to DB
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("ERROR: MONGODB_URI not set");
    process.exit(1);
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const dbName = process.env.MONGODB_DB_NAME || "campusdrive_dev";
    const db = client.db(dbName);
    const collection = db.collection(COLLECTION);

    if (reset) {
      const deleted = await collection.deleteMany({});
      console.log(`\nReset: deleted ${deleted.deletedCount} existing topics.`);
    }

    // Check for existing topics
    const existing = await collection.countDocuments();
    if (existing > 0 && !reset) {
      console.log(`\nWARNING: ${existing} topics already exist. Use --reset to replace them.`);
      console.log("Skipping topics that already exist by name...\n");

      const existingNames = new Set(
        (await collection.find({}, { projection: { name: 1 } }).toArray()).map((d) => d.name),
      );

      const newTopics = allTopics.filter((t) => !existingNames.has(t.name));
      if (newTopics.length === 0) {
        console.log("No new topics to insert. All topics already exist.");
        return;
      }

      await collection.insertMany(newTopics);
      console.log(`Inserted ${newTopics.length} new topics (skipped ${allTopics.length - newTopics.length} existing).`);
    } else {
      await collection.insertMany(allTopics);
      console.log(`\nInserted ${allTopics.length} topics into ${COLLECTION}.`);
    }

    // Ensure indexes
    await collection.createIndex({ name: 1 }, { unique: true });
    await collection.createIndex({ category: 1 });
    await collection.createIndex({ priority: 1 });
    console.log("Indexes ensured.");

    console.log("\nDone! Topics are ready for guide generation.\n");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
