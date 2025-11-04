export default async function handler(req, res) {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Only POST requests allowed' });
    }

    try {
        // Validate request body
        if (!req.body) {
            return res.status(400).json({ error: 'Request body is required' });
        }

        const { message, weatherContext, conversationHistory } = req.body;

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Message is required and must be a string' });
        }

        // Check if API key exists
        if (!process.env.GEMINI_API_KEY) {
            console.error('GEMINI_API_KEY is not set');
            return res.status(500).json({ error: 'API key not configured' });
        }

        // Build context prompt with better formatting
        let contextPrompt = `You are Climabot AI, an advanced weather assistant. You provide helpful, accurate, and engaging responses about weather, climate, and atmospheric conditions.

Instructions:
- Be conversational and friendly
- Use weather emojis appropriately  
- Provide accurate information
- If you don't know something specific, be honest
- Keep responses informative but concise
- Focus on being helpful for weather-related queries

`;

        // Add weather context if available
        if (weatherContext && weatherContext.location) {
            contextPrompt += `Current Weather Context:
- Location: ${weatherContext.location}
- Temperature: ${weatherContext.temperature}°C
- Conditions: ${weatherContext.condition}
- Data from: ${new Date(weatherContext.timestamp).toLocaleString()}

`;
        }

        // Add conversation history if available
        if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
            contextPrompt += "Recent conversation:\n";
            conversationHistory.forEach(entry => {
                if (entry && entry.type && entry.message) {
                    contextPrompt += `${entry.type}: ${entry.message}\n`;
                }
            });
            contextPrompt += "\n";
        }

        contextPrompt += `User Question: ${message}

Please provide a helpful response:`;

        // Updated request body for Gemini API
        const requestBody = {
            contents: [{
                parts: [{
                    text: contextPrompt
                }]
            }],
            generationConfig: {
                temperature: 0.7,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 1024,
                candidateCount: 1
            },
            safetySettings: [
                {
                    category: "HARM_CATEGORY_HARASSMENT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_HATE_SPEECH",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                }
            ]
        };

        console.log('Making request to Gemini API...');
        console.log('API Key exists:', !!process.env.GEMINI_API_KEY);
        console.log('API Key prefix:', process.env.GEMINI_API_KEY?.substring(0, 10) + '...' || 'Not found');

        // Updated API URL with v1beta and correct model name
        // Use the correct model name for v1beta API
        const model = 'gemini-pro'; // Most stable model
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

        console.log('API URL:', apiUrl.replace(process.env.GEMINI_API_KEY, 'API_KEY_HIDDEN'));

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        console.log('Gemini API response status:', response.status);
        console.log('Gemini API response headers:', Object.fromEntries(response.headers.entries()));

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Gemini API error response:', errorText);

            let errorMessage = 'Failed to get response from AI service';

            if (response.status === 400) {
                errorMessage = 'Invalid request to AI service - check your API key format';
                console.error('400 Error - Possible issues: Invalid API key format, malformed request, or quota exceeded');
            } else if (response.status === 401) {
                errorMessage = 'Invalid API key - please check your GEMINI_API_KEY';
                console.error('401 Error - API key is invalid or missing');
            } else if (response.status === 403) {
                errorMessage = 'API access forbidden - check your API key permissions and billing';
                console.error('403 Error - API key lacks permissions or billing issues');
            } else if (response.status === 429) {
                errorMessage = 'Too many requests - please try again later';
                console.error('429 Error - Rate limit exceeded');
            } else if (response.status >= 500) {
                errorMessage = 'AI service temporarily unavailable';
                console.error('5XX Error - Server-side issue');
            }

            return res.status(response.status).json({
                error: errorMessage,
                details: process.env.NODE_ENV === 'development' ? errorText : undefined
            });
        }

        const data = await response.json();
        console.log('Gemini API success response structure:', {
            hasCandidates: !!data.candidates,
            candidatesLength: data.candidates?.length || 0,
            hasContent: !!data.candidates?.[0]?.content,
            hasParts: !!data.candidates?.[0]?.content?.parts,
            partsLength: data.candidates?.[0]?.content?.parts?.length || 0
        });

        // Extract the response with better error handling
        let result = "I apologize, but I couldn't generate a response right now. Please try again.";

        if (data.candidates && data.candidates.length > 0) {
            const candidate = data.candidates[0];

            // Check if the response was blocked
            if (candidate.finishReason === 'SAFETY') {
                result = "I apologize, but I cannot provide a response to that query due to safety guidelines. Please try rephrasing your question.";
            } else if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                const part = candidate.content.parts[0];
                if (part.text && part.text.trim()) {
                    result = part.text.trim();
                }
            }
        }

        res.status(200).json({ response: result });

    } catch (error) {
        console.error('Detailed error:', error);
        console.error('Error stack:', error.stack);

        // Handle different types of errors
        let errorMessage = 'Internal server error';
        let statusCode = 500;

        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            errorMessage = 'Failed to connect to AI service - check internet connection';
            statusCode = 503;
        } else if (error.message.includes('JSON')) {
            errorMessage = 'Invalid response from AI service';
            statusCode = 502;
        } else if (error.code === 'ENOTFOUND') {
            errorMessage = 'DNS resolution failed - check internet connection';
            statusCode = 503;
        }

        res.status(statusCode).json({
            error: errorMessage,
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}