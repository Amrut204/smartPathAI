const fs = require('fs');
const path = require('path');
const https = require('https');

const MATERIAL_DIR = path.resolve('C:/vscode/smartPathAI-mern/material');
const OUTPUT_DIR = path.resolve('C:/vscode/smartPathAI-mern/analysis_output/study_documents');
const MANIFEST_FILE = path.join(OUTPUT_DIR, 'manifest.jsonl');

const EXCLUDED_DIRS = [
    'node_modules', 'dist', '.git', 'analysis_output',
    'placement_scraper_output', 'open_resource_scraper',
    'question_source_scraper', 'repo_resource_harvester'
];

function getFiles(dir, files = []) {
    if (!fs.existsSync(dir)) return files;
    const items = fs.readdirSync(dir);
    for (const item of items) {
        const fullPath = path.join(dir, item);
        const relativePath = path.relative(MATERIAL_DIR, fullPath).replace(/\\/g, '/');

        let shouldExclude = false;
        for (const ex of EXCLUDED_DIRS) {
            if (relativePath.startsWith(ex + '/') || relativePath === ex || relativePath.includes('/' + ex + '/')) {
                shouldExclude = true;
                break;
            }
        }
        if (shouldExclude) continue;

        if (fs.statSync(fullPath).isDirectory()) {
            getFiles(fullPath, files);
        } else {
            const ext = path.extname(fullPath).toLowerCase();
            if (['.md', '.markdown', '.txt'].includes(ext)) {
                files.push(fullPath);
            }
        }
    }
    return files;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callAIOpenRouter(promptText) {
    const key = process.env.OPENROUTER_API_KEY;
    const APP_URL = process.env.APP_URL || "http://localhost:5173";
    const APP_NAME = process.env.APP_NAME || "CampusDrive AI";

    const body = JSON.stringify({
        model: "meta-llama/llama-3.1-8b-instruct:free",
        messages: [{ role: "user", content: promptText }],
        temperature: 0.1,
        response_format: { type: "json_object" }
    });

    return new Promise((resolve, reject) => {
        const req = https.request('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            timeout: 20000,
            headers: {
                'Authorization': `Bearer ${key}`,
                'HTTP-Referer': APP_URL,
                'X-Title': APP_NAME,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`OpenRouter API Error: ${res.statusCode} ${data}`));
                } else {
                    try {
                        const json = JSON.parse(data);
                        resolve(json.choices[0].message.content);
                    } catch (e) {
                        reject(e);
                    }
                }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error("OpenRouter timeout"));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function callAIGemini(promptText) {
    const key = process.env.GEMINI_API_KEY;
    const body = JSON.stringify({
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
    });

    return new Promise((resolve, reject) => {
        const req = https.request(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Gemini API Error: ${res.statusCode} ${data}`));
                } else {
                    try {
                        const json = JSON.parse(data);
                        let text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (!text) throw new Error("No text in Gemini response");
                        resolve(text);
                    } catch (e) {
                        reject(e);
                    }
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function processContent(content) {
    const limit = 6000;
    if (content.length > limit) content = content.substring(0, limit) + "... [truncated]";

    // Quick heuristic for junk
    if (content.trim().length < 20) {
        return Promise.resolve('{"status": "rejected"}');
    }

    const sysPrompt = `You are a read-only content transformation assistant.
Your task is to transform local note-style resource files into a structured JSON "study document".
If the source file is empty, junk, navigation-only, badge-only, or not useful for learning, output exactly {"status": "rejected"}.

Otherwise, infer the topic and extract the core explanation.
Remove noisy content (badges, banners, installation instructions unless educational, repo boilerplate, raw HTML, links).
Prefer educational clarity over source fidelity. Convert messy README content into student-friendly notes.

Output ONLY valid JSON matching exactly this schema:
{
  "status": "ok",
  "title": "clean inferred title",
  "topic": "best inferred topic",
  "subtopic": "best inferred subtopic",
  "branch_relevance": ["CSE","IT","ECE","EEE","ME","Civil"] or ["all"],
  "career_tracks": ["aptitude","verbal","HR interview","technical interview","core subjects","software placement crossover","analyst/data crossover"],
  "difficulty": "easy" | "medium" | "hard" | "unknown",
  "resource_type": "study_document",
  "what_this_covers": "short paragraph",
  "key_concepts": ["concept 1", "concept 2", "etc"],
  "important_definitions": ["def 1", "def 2", "etc"],
  "core_explanation": "clear learner-friendly explanation in Markdown, no raw HTML",
  "step_by_step_understanding": ["step 1", "step 2", "etc"],
  "interview_focus": ["point 1", "etc"],
  "common_mistakes": ["mistake 1", "etc"],
  "quick_revision_points": ["point 1", "etc"],
  "practice_prompts": ["prompt 1", "etc"],
  "recommended_for": ["audience 1", "etc"],
  "search_text": "dense retrieval-friendly paragraph including topic terms, interview terms, formulas, concepts, and likely search phrases",
  "source_quality_notes": "brief note about source cleanup quality"
}

Text to process:
----------------
${content}
`;

    return callAIGemini(sysPrompt).catch(err => {
        console.warn('Gemini failed, trying OpenRouter...', err.message);
        return callAIOpenRouter(sysPrompt);
    });
}

async function main() {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    if (fs.existsSync(MANIFEST_FILE)) fs.unlinkSync(MANIFEST_FILE);

    console.log("Scanning files...");
    const files = getFiles(MATERIAL_DIR).filter(f=>f.includes(\'Networking_README.md\')).slice(0, 1);
    console.log(`Found ${files.length} valid text files.`);

    const summary = {
        total_scanned: files.length,
        total_success: 0,
        total_rejected: 0,
        total_failed: 0,
        topics: {}
    };

    let count = 0;

    // Process in batches
    const BATCH_SIZE = 15;

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);

        await Promise.all(batch.map(async (file) => {
            count++;
            const relativePathStr = path.relative(MATERIAL_DIR, file).replace(/\\/g, '/');
            // console.log(`[${count}/${files.length}] Checking ${relativePathStr}`);

            let content = '';
            try {
                content = fs.readFileSync(file, 'utf8');
            } catch (e) {
                summary.total_failed++;
                return;
            }

            let textLower = content.toLowerCase();
            // Aggressive fast reject heuristics
            let plainText = content.replace(/!\[.*?\]\(.*?\)/g, '')
                .replace(/\[.*?\]\(.*?\)/g, '')
                .replace(/<[^>]+>/g, '')
                .replace(/```[\s\S]*?```/g, '')
                .trim();
            let words = plainText.split(/\s+/).filter(w => w.length > 1);

            if (
                words.length < 30 ||
                (textLower.includes('<!doctype html') && !textLower.includes('class')) ||
                (textLower.startsWith('{"') && textLower.endsWith('}')) ||
                textLower.includes('t.me/campusdrive') ||
                textLower.includes('@campusdrive') ||
                (plainText.length < 150)
            ) {
                summary.total_rejected++;
                return;
            }

            let aiResultObj = null;

            try {
                console.log(`Sending to AI: ${relativePathStr} (words: ${words.length})`);
                let aiResultText = await processContent(content);
                // Clean markdown code blocks from JSON
                aiResultText = aiResultText.replace(/^```(json)?\n?/, '').replace(/```\n?$/, '').trim();
                aiResultObj = JSON.parse(aiResultText);
            } catch (err) {
                console.error(`Error processing ${relativePathStr}:`, err.message);
                summary.total_failed++;
                return;
            }

            if (!aiResultObj) {
                summary.total_failed++;
                return;
            }

            const relativePath = path.relative(MATERIAL_DIR, file).replace(/\\/g, '/');
            const fileName = path.basename(file);

            if (aiResultObj.status === 'rejected' || aiResultObj.status === 'failed' || aiResultObj.status === 'low_quality') {
                summary.total_rejected++;
                return; // Proceed to next
            }

            summary.total_success++;
            const topic = aiResultObj.topic || 'unknown';
            summary.topics[topic] = (summary.topics[topic] || 0) + 1;

            // Ensure defaults
            aiResultObj.source_path = file.replace(/\\/g, '/');
            aiResultObj.relative_path = relativePath;
            aiResultObj.file_name = fileName;
            aiResultObj.resource_type = "study_document";

            const safeBaseName = relativePath.replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 150);
            const jsonOutPath = path.join(OUTPUT_DIR, safeBaseName + '.json');
            const mdOutPath = path.join(OUTPUT_DIR, safeBaseName + '.md');

            fs.writeFileSync(jsonOutPath, JSON.stringify(aiResultObj, null, 2), "utf8");

            const mdContent = `# ${aiResultObj.title || 'Untitled'}

Source Path: ${aiResultObj.source_path}
Relative Path: ${aiResultObj.relative_path}

## What This Covers
${aiResultObj.what_this_covers || 'N/A'}

## Key Concepts
${(aiResultObj.key_concepts || []).map(x => '- ' + x).join('\n')}

## Important Definitions
${(aiResultObj.important_definitions || []).map(x => '- ' + x).join('\n')}

## Core Explanation
${aiResultObj.core_explanation || 'N/A'}

## Step-by-Step Understanding
${(aiResultObj.step_by_step_understanding || []).map((x, i) => (i + 1) + '. ' + x).join('\n')}

## Interview Focus
${(aiResultObj.interview_focus || []).map(x => '- ' + x).join('\n')}

## Common Mistakes
${(aiResultObj.common_mistakes || []).map(x => '- ' + x).join('\n')}

## Quick Revision Points
${(aiResultObj.quick_revision_points || []).map(x => '- ' + x).join('\n')}

## Practice Prompts
${(aiResultObj.practice_prompts || []).map(x => '- ' + x).join('\n')}

## Recommended For
${(aiResultObj.recommended_for || []).map(x => '- ' + x).join('\n')}

## Source Quality Notes
${aiResultObj.source_quality_notes || 'N/A'}
`;

            fs.writeFileSync(mdOutPath, mdContent.trim(), "utf8");
            fs.appendFileSync(MANIFEST_FILE, JSON.stringify(aiResultObj) + "\n", "utf8");
        }));

        // Wait a bit between batches to avoid rate limits
        await sleep(1000);
    }

    console.log("\n===============================");
    console.log("FINAL SUMMARY");
    console.log(`- total files scanned: ${summary.total_scanned}`);
    console.log(`- total transformed successfully: ${summary.total_success}`);
    console.log(`- total rejected: ${summary.total_rejected}`);
    console.log(`- total failed: ${summary.total_failed}`);

    // Top inferred topics
    const sortedTopics = Object.entries(summary.topics).sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log("- top inferred topics:");
    sortedTopics.forEach(([t, c]) => {
        console.log(`  * ${t} (${c} items)`);
    });
    console.log("===============================");
}

main().catch(console.error);
