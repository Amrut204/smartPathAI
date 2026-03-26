const fs = require('fs');
const path = require('path');
const https = require('https');

const MATERIAL_DIR = path.resolve('C:/vscode/smartPathAI-mern/material');
const OUTPUT_DIR = path.resolve('C:/vscode/smartPathAI-mern/analysis_output/readme_triage');
const MANIFEST_FILE = path.join(OUTPUT_DIR, 'triage_manifest.jsonl');
const SUMMARY_FILE = path.join(OUTPUT_DIR, 'triage_summary.json');

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
            const basename = path.basename(fullPath).toLowerCase();
            if (basename.includes('readme') && (ext === '.md' || ext === '.markdown' || ext === '.txt')) {
                files.push(fullPath);
            }
        }
    }
    return files;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
                        if (!text) throw new Error(`No text in Gemini response.`);
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

async function callAIGroq(promptText) {
    const groqKey = process.env.GROQ_API_KEY;
    const body = JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: promptText }],
        temperature: 0.1,
        response_format: { type: "json_object" }
    });

    return new Promise((resolve, reject) => {
        const req = https.request('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${groqKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Groq API Error: ${res.statusCode} ${data}`));
                } else {
                    try {
                        const json = JSON.parse(data);
                        if (!json.choices || !json.choices[0] || !json.choices[0].message) {
                            throw new Error(`Invalid Groq response.`);
                        }
                        resolve(json.choices[0].message.content);
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

async function callAIOpenRouter(promptText, retries = 3) {
    const key = process.env.OPENROUTER_API_KEY;
    const body = JSON.stringify({
        models: ["google/gemma-3-27b-it:free", "mistralai/mistral-small-3.1-24b-instruct:free", "meta-llama/llama-3.2-3b-instruct:free"],
        route: "fallback",
        messages: [{ role: "user", content: promptText }],
        temperature: 0.1,
        response_format: { type: "json_object" }
    });

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await new Promise((resolve, reject) => {
                const req = https.request('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'HTTP-Referer': process.env.APP_URL || "http://localhost:5173",
                        'X-Title': process.env.APP_NAME || "CampusDrive AI",
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
                                if (!json.choices || !json.choices[0] || !json.choices[0].message) {
                                    throw new Error(`Invalid OpenRouter response.`);
                                }
                                resolve(json.choices[0].message.content);
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
        } catch (err) {
            if (err.message.includes('429') && attempt < retries) {
                console.warn(`OpenRouter 429 on attempt ${attempt}, waiting 15s...`);
                await sleep(15000);
            } else {
                throw err;
            }
        }
    }
}

async function processContent(content) {
    const limit = 6000;
    if (content.length > limit) content = content.substring(0, limit) + "... [truncated]";

    const sysPrompt = `You are a read-only content triage assistant.
Your task is to review a README-based note file and classify it.

Classification buckets:
1. clean_only
Use this when:
- the file has real educational content
- structure is messy but salvageable with rule-based cleanup
- the main problem is formatting, markdown noise, HTML tags, badges, extra sections, or clutter

2. transform
Use this when:
- the file contains educational value
- but the structure is too weak for simple cleanup
- content should be rewritten into a study-document format for students

3. hide
Use this when:
- the file is mostly repo navigation
- badge/link collection
- contribution/license/setup boilerplate
- promotional text
- folder index with no meaningful learning value
- too thin to be useful even after transformation

Output ONLY valid JSON matching exactly this schema:
{
  "bucket": "clean_only" | "transform" | "hide",
  "confidence": "high" | "medium" | "low",
  "topic_hint": "best inferred topic",
  "reason": "short explanation of why this file belongs in this bucket",
  "estimated_value": "high" | "medium" | "low",
  "suggested_next_action": "clean_render" | "ai_transform" | "hide_from_students",
  "contains_useful_learning_content": true or false
}

Text to process:
----------------
${content}
`;

    return callAIGemini(sysPrompt).catch(err => {
        console.warn('Gemini failed, trying Groq...', err.message);
        return callAIGroq(sysPrompt).catch(err2 => {
            console.warn('Groq failed, trying OpenRouter...', err2.message);
            return callAIOpenRouter(sysPrompt);
        });
    });
}

function fastHeuristic(content, relativePath) {
    let lower = content.toLowerCase();
    let plainText = content.replace(/!\[.*?\]\(.*?\)/g, '')
        .replace(/\[.*?\]\(.*?\)/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .trim();
    let words = plainText.split(/\s+/).filter(w => w.length > 1);

    if (
        words.length < 15 ||
        lower.includes('t.me/campusdrive') ||
        lower.includes('@campusdrive') ||
        (plainText.length < 50 && !lower.includes('topic'))
    ) {
        return {
            bucket: "hide",
            confidence: "high",
            topic_hint: "none",
            reason: "Too thin or boilerplate (detected by fast heuristic)",
            estimated_value: "low",
            suggested_next_action: "hide_from_students",
            contains_useful_learning_content: false
        };
    }

    if (
        lower.includes('table of contents') &&
        words.length < 100 &&
        lower.includes('contributing')
    ) {
        return {
            bucket: "hide",
            confidence: "high",
            topic_hint: "index",
            reason: "Appears to be a repository root navigational README",
            estimated_value: "low",
            suggested_next_action: "hide_from_students",
            contains_useful_learning_content: false
        };
    }
    return null;
}

async function main() {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    let manifestEntries = [];
    let processedPaths = new Set();

    if (fs.existsSync(MANIFEST_FILE)) {
        const lines = fs.readFileSync(MANIFEST_FILE, 'utf8').split('\n').filter(Boolean);
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                manifestEntries.push(entry);
                processedPaths.add(entry.source_path);
            } catch (e) { }
        }
    }

    console.log("Scanning files for README triage...");
    const allFiles = getFiles(MATERIAL_DIR);
    console.log(`Found ${allFiles.length} target files to triage.`);

    let toProcess = allFiles.filter(f => !processedPaths.has(f.replace(/\\/g, '/')));
    console.log(`${toProcess.length} remaining to classify.`);

    const summary = {
        total_triaged: manifestEntries.length,
        clean_only: manifestEntries.filter(m => m.bucket === 'clean_only').length,
        transform: manifestEntries.filter(m => m.bucket === 'transform').length,
        hide: manifestEntries.filter(m => m.bucket === 'hide').length,
        rate_limited: false,
        topics: {},
        top_transform: [],
        top_clean_only: []
    };

    let rateLimited = false;

    for (let i = 0; i < toProcess.length; i++) {
        if (rateLimited) break;

        let file = toProcess[i];
        let relativePathStr = path.relative(MATERIAL_DIR, file).replace(/\\/g, '/');
        console.log(`[${i + 1}/${toProcess.length}] Classifying ${relativePathStr}`);

        let content = '';
        try {
            content = fs.readFileSync(file, 'utf8');
        } catch (e) { continue; }

        let aiResultObj = fastHeuristic(content, relativePathStr);
        let usedAI = false;

        if (!aiResultObj) {
            try {
                let aiResultText = await processContent(content);
                aiResultText = aiResultText.replace(/^\s*```(json)?\n?/, '').replace(/```\n?\s*$/, '').trim();
                aiResultObj = JSON.parse(aiResultText);
                usedAI = true;
            } catch (err) {
                console.error(`Error classifying ${relativePathStr}: ${err.message}`);
                if (err.message.includes('429') || err.message.toLowerCase().includes('quota') || err.message.includes('limits')) {
                    console.log("Rate limit hit on all providers. Breaking batch early.");
                    rateLimited = true;
                    summary.rate_limited = true;
                    break;
                }
                aiResultObj = {
                    bucket: 'hide',
                    confidence: 'low',
                    topic_hint: 'unknown',
                    reason: `Error during classification: ${err.message}`,
                    estimated_value: 'low',
                    suggested_next_action: 'hide_from_students',
                    contains_useful_learning_content: false
                };
            }
        }

        let entry = {
            source_path: file.replace(/\\/g, '/'),
            relative_path: relativePathStr,
            file_name: path.basename(file),
            ...aiResultObj
        };

        manifestEntries.push(entry);
        processedPaths.add(entry.source_path);

        summary.total_triaged++;
        if (entry.bucket === 'clean_only') summary.clean_only++;
        else if (entry.bucket === 'transform') summary.transform++;
        else if (entry.bucket === 'hide') summary.hide++;

        fs.appendFileSync(MANIFEST_FILE, JSON.stringify(entry) + '\n', 'utf8');

        if (usedAI) {
            await sleep(5000); // Prevent rapid API exhaustion
        }
    }

    // Process summary stats
    for (const entry of manifestEntries) {
        if (entry.topic_hint && entry.topic_hint !== 'none' && entry.topic_hint !== 'unknown') {
            summary.topics[entry.topic_hint] = (summary.topics[entry.topic_hint] || 0) + 1;
        }
        if (entry.bucket === 'transform' && entry.estimated_value === 'high') {
            summary.top_transform.push(entry.relative_path);
        }
        if (entry.bucket === 'clean_only' && entry.estimated_value === 'high') {
            summary.top_clean_only.push(entry.relative_path);
        }
    }

    // Deduplicate top arrays
    summary.top_transform = [...new Set(summary.top_transform)];
    summary.top_clean_only = [...new Set(summary.top_clean_only)];

    fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2), 'utf8');

    // Create tracking files
    const cleanOnlyPaths = manifestEntries.filter(e => e.bucket === 'clean_only').map(e => e.relative_path);
    const transformPaths = manifestEntries.filter(e => e.bucket === 'transform').map(e => e.relative_path);
    const hidePaths = manifestEntries.filter(e => e.bucket === 'hide').map(e => e.relative_path);

    fs.writeFileSync(path.join(OUTPUT_DIR, 'clean_only_paths.txt'), cleanOnlyPaths.join('\n') + (cleanOnlyPaths.length ? '\n' : ''), 'utf8');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'transform_paths.txt'), transformPaths.join('\n') + (transformPaths.length ? '\n' : ''), 'utf8');
    fs.writeFileSync(path.join(OUTPUT_DIR, 'hide_paths.txt'), hidePaths.join('\n') + (hidePaths.length ? '\n' : ''), 'utf8');

    console.log("\n===============================");
    console.log("TRIAGE RUN SUMMARY");
    console.log(`- total files triaged: ${summary.total_triaged}`);
    console.log(`- clean_only: ${summary.clean_only}`);
    console.log(`- transform: ${summary.transform}`);
    console.log(`- hide: ${summary.hide}`);
    console.log(`- rate limited: ${rateLimited}`);

    const sortedTopics = Object.entries(summary.topics).sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log("- top topic hints:");
    sortedTopics.forEach(([t, c]) => {
        console.log(`  * ${t} (${c} items)`);
    });
    console.log(`- highest-value transform candidates: ${summary.top_transform.length}`);
    console.log(`- highest-value clean_only candidates: ${summary.top_clean_only.length}`);
    console.log("===============================");
}

main().catch(console.error);
