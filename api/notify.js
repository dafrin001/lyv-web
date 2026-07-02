import admin from 'firebase-admin';

// Init Firebase Admin only once
if (!admin.apps.length) {
    try {
        let serviceAccount;
        
        // Option 1: Env Var (Best for Vercel)
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            // Handle if it's a stringified JSON or base64
            let raw = process.env.FIREBASE_SERVICE_ACCOUNT;
            // Clean slightly just in case
            if (raw.startsWith('"') && raw.endsWith('"')) {
                raw = JSON.parse(raw); // Decode stringified JSON
            }
            if (typeof raw === 'string') {
                serviceAccount = JSON.parse(raw);
            } else {
                serviceAccount = raw;
            }
        } 
// Option 2: Local File (Fallback & Uploaded File Support)
        else {
            const fs = require('fs');
            const path = require('path');
            
            // Try multiple paths because Vercel structure varies
            const pathsToTry = [
                path.resolve(__dirname, '../service-account.json'), // Local dev / Standard
                path.resolve(process.cwd(), 'service-account.json'), // Root
                path.resolve('/var/task/service-account.json') // AWS Lambda typical
            ];

            for (const p of pathsToTry) {
                if (fs.existsSync(p)) {
                    console.log("Found credentials at:", p);
                    serviceAccount = require(p);
                    break;
                }
            }
            
            if (!serviceAccount) console.warn("No local service-account.json found in paths:", pathsToTry);
        }

        if (serviceAccount) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
        }
    } catch (e) {
        console.error("Firebase Admin Init Failed:", e);
    }
}

export default async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') return res.status(405).json({error: "Method Not Allowed"});

    const { title, body, tokens } = req.body;
    if (!tokens || !tokens.length) return res.status(400).json({ error: "No tokens provided" });

    if (!admin.apps.length) {
         return res.status(500).json({ 
             error: "Servidor Misconfigurado: Falta credencial FIREBASE_SERVICE_ACCOUNT (JSON) en variables de entorno." 
         });
    }

    // Construct Message (Multicast)
    const message = {
        tokens: tokens,
        notification: {
            title: title,
            body: body
        },
        // Android specific config for high priority
        android: {
            priority: 'high',
            notification: {
                clickAction: 'FCM_PLUGIN_ACTIVITY',
                icon: 'default', // or local resource name
                sound: 'default'
            }
        },
        data: {
            landing_page: 'view-dashboard'
        }
    };

    try {
        const response = await admin.messaging().sendMulticast(message);
        console.log("FCM Success:", response.successCount);
        if (response.failureCount > 0) {
            const failedTokens = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    failedTokens.push(tokens[idx]);
                    console.error("FCM Token Error:", resp.error);
                }
            });
        }
        return res.status(200).json(response);
    } catch (error) {
        console.error("FCM Send Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
