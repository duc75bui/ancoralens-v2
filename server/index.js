/**
 * AncoraLens server (Express). Two responsibilities:
 *   1. Serve the built frontend (../dist) + SPA fallback in production (single-port deploy).
 *   2. Provide the /api endpoints the browser needs for network features:
 *        GET  /api/health        - liveness probe
 *        POST /api/ai/test|chat  - Google Gemini proxy (API key supplied per-request)
 *        POST /api/sql/execute   - MSSQL query (blocks DROP DATABASE / SHUTDOWN)
 * No secrets are stored server-side. Listens on env PORT (default 3001; deploy sets 8080).
 * See ARCHITECTURE.md §9 and DEPLOY_IIS.md.
 */
import express from 'express';
import sql from 'mssql';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increased for CSV context

// Serve the built frontend (dist/) when present — enables a single-port production deploy.
// In the deploy package the layout is:  <root>/dist  and  <root>/server/index.js
const distPath = path.join(__dirname, '..', 'dist');
const hasDist = fs.existsSync(path.join(distPath, 'index.html'));
if (hasDist) {
    app.use(express.static(distPath));
    console.log(`Serving frontend from ${distPath}`);
}

// Test endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'SQL Backend is running' });
});

// ============ AI ENDPOINTS ============

// Test AI connection
app.post('/api/ai/test', async (req, res) => {
    const { apiKey, model: modelName } = req.body;
    if (!apiKey) {
        return res.status(400).json({ error: 'API key is required' });
    }
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName || 'gemini-1.5-flash' });
        const result = await model.generateContent('Reply with just: Connected');
        const response = await result.response;
        res.json({ connected: true, message: response.text() });
    } catch (err) {
        console.error('AI Connection Error:', err.message);
        res.status(500).json({ connected: false, error: err.message });
    }
});

// Chat with AI about data
app.post('/api/ai/chat', async (req, res) => {
    const { apiKey, message, dataContext, history, model: modelName } = req.body;
    if (!apiKey || !message) {
        return res.status(400).json({ error: 'API key and message are required' });
    }
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName || 'gemini-1.5-flash' });

        // Build the system prompt with data context
        const systemPrompt = `You are an AI assistant for the ancoraLens dashboard, which analyzes document processing accuracy reports.
The user has uploaded CSV data containing document processing metrics. Here is a summary of their data:

${dataContext || 'No data has been uploaded yet.'}

Help the user understand their data, identify trends, find issues, and answer questions about document processing accuracy.
Be concise but thorough. Use specific numbers from the data when possible.`;

        // Prepend system prompt to history (better compatibility)
        const chatHistory = [
            {
                role: 'user',
                parts: [{ text: systemPrompt }]
            },
            {
                role: 'model',
                parts: [{ text: 'Understood. I have analyzed the data summary. I am ready to answer your questions about the document processing accuracy.' }]
            },
            ...(history || []).map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content }]
            }))
        ];

        const chat = model.startChat({
            history: chatHistory
        });

        const result = await chat.sendMessage(message);
        const response = await result.response;
        res.json({ response: response.text() });
    } catch (err) {
        console.error('AI Chat Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Execute SQL Query Endpoint
app.post('/api/sql/execute', async (req, res) => {
    const { connectionString, query } = req.body;

    if (!connectionString || !query) {
        return res.status(400).json({ error: 'Connection string and query are required.' });
    }

    // Basic safety check - prevent extremely dangerous operations if possible, 
    // though this tool is intended for admins who know what they are doing.
    const forbiddenKeywords = ['DROP DATABASE', 'SHUTDOWN']; 
    if (forbiddenKeywords.some(keyword => query.toUpperCase().includes(keyword))) {
        return res.status(400).json({ error: 'Operation not allowed for safety.' });
    }

    try {
        await sql.connect(connectionString);
        const result = await sql.query(query);
        await sql.close();

        res.json({
            rowsAffected: result.rowsAffected,
            recordset: result.recordset
        });
    } catch (err) {
        console.error('SQL Execution Error:', err);
        // Ensure connection is closed even on error
        try { await sql.close(); } catch (e) {} 
        
        res.status(500).json({ 
            error: err.message, 
            code: err.code,
            originalError: err 
        });
    }
});
// SPA fallback: any non-API GET returns index.html so client-side views resolve.
if (hasDist) {
    app.get(/^\/(?!api\/).*/, (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });
}

// Start Server
app.listen(PORT, () => {
    console.log(`AncoraLens server running on http://localhost:${PORT}`);
    console.log(`  • API:     http://localhost:${PORT}/api/health`);
    if (hasDist) console.log(`  • App UI:  http://localhost:${PORT}/`);
});

process.on('SIGINT', async () => {
    try {
        await sql.close();
        console.log('SQL connection closed');
    } catch(e) {}
    process.exit(0);
});
