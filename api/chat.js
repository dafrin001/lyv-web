export const config = {
    runtime: 'edge', 
};

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
};

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }

    try {
        const input = await req.json();
        const userMessage = input.message;
        const systemInstruction = input.system_instruction; // "Eres Esperanza..."
        const history = input.history || []; // [{role: 'user'|'assistant', content: '...'}]
        
        // Use Environment Variable or Fallback
        const GroqApiKey = process.env.GROQ_API_KEY;

        if (!userMessage) {
            return new Response(JSON.stringify({ error: 'Missing message' }), { 
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }

        const url = 'https://api.groq.com/openai/v1/chat/completions';

        // Construct Messages Array for OpenAI/Groq format
        // 1. System Prompt
        const messages = [
            { role: "system", content: systemInstruction || "Eres un asistente útil." }
        ];

        // 2. Insert History (Already in {role, content} format from frontend)
        // Ensure roles are valid (user, assistant, system)
        history.forEach(msg => {
            if (msg.role && msg.content) {
                messages.push({
                    role: msg.role,
                    content: msg.content
                });
            }
        });

        // 3. Current User Message
        messages.push({ role: "user", content: userMessage });

        const payload = {
            model: "llama-3.3-70b-versatile", // Using the latest persistent model
            messages: messages,
            temperature: 0.6,
            max_tokens: 1024
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${GroqApiKey}`
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
           console.error("Groq API Error:", JSON.stringify(result));
           return new Response(JSON.stringify(result), { 
               status: response.status,
               headers: { 'Content-Type': 'application/json', ...corsHeaders }
           });
        }

        // Extract the actual text response to match what the frontend expects
        // Or return standard OpenAI format and let frontend handle it.
        // Let's keep it simple: return the text directly in a 'candidates' like structure 
        // OR just return the OpenAI response and update frontend to read choices[0].
        
        // I will return the Full OpenAI response structure, but I'll add a helper field for easy migration?
        // No, let's Stick to the Standard. Frontend will need to read `choices[0].message.content`
        
        return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 
                'Content-Type': 'application/json',
                ...corsHeaders
            }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
    }
}
